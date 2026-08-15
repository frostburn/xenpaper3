{
  /**
   * Xenpaper 3 surface grammar.
   *
   * This grammar intentionally produces an untyped syntax tree. Contextual
   * distinctions such as playable integer degree vs scalar integer, ratio vs
   * interval coercion, directive scope, repeat expansion, and score duration
   * belong to later compiler passes.
   */

  const node = (type, properties = {}, loc = location()) => ({
    type,
    ...properties,
    location: loc,
  });

  const unary = (operator, operand, loc = location()) =>
    node('UnaryExpression', { operator, operand }, loc);

  const binary = (operator, left, right, loc = location()) =>
    node('BinaryExpression', { operator, left, right }, loc);

  const foldBinary = (head, tail, loc = location()) => {
    let result = head;
    for (const part of tail) {
      result = binary(part.operator, result, part.right, loc);
    }
    return result;
  };

  const sequence = (items, loc = location()) =>
    items.length === 1 ? items[0] : node('Sequence', { items }, loc);

  const parallel = (branches, loc = location()) =>
    branches.length === 1 ? branches[0] : node('Parallel', { branches }, loc);

  const commentsByOffset = new Map();

  const rememberComment = (raw, loc = location()) => {
    const comment = node('Comment', {
      value: raw.slice(1),
      raw,
    }, loc);
    // Peggy may revisit a spacing production while backtracking. Source offset
    // makes comment collection idempotent.
    commentsByOffset.set(loc.start.offset, comment);
    return comment;
  };

  const modifierKind = raw => {
    switch (raw) {
      case "'": return 'equaveUp';
      case '"': return 'doubleEquaveUp';
      case '`': return 'equaveDown';
      case '^': return 'up';
      case 'v': return 'down';
      case '/': return 'lift';
      case '\\': return 'drop';
      default: return 'unknown';
    }
  };
}

Start
  = Spacing body:DocumentBody? Spacing !. {
      const source = text();
      return node('Program', {
        source,
        body: body ?? [],
        comments: [...commentsByOffset.values()].sort(
          (a, b) => a.location.start.offset - b.location.start.offset,
        ),
      });
    }

DocumentBody
  = first:ParallelExpression?
    rest:(Spacing boundary:HardBoundary Spacing next:ParallelExpression? {
      return { boundary, next };
    })* {
      const body = [];
      if (first) body.push(first);
      for (const part of rest) {
        body.push(part.boundary);
        if (part.next) body.push(part.next);
      }
      return body;
    }

ParallelExpression
  = first:SequenceExpression
    rest:(Spacing "," Spacing branch:SequenceExpression { return branch; })* {
      return parallel([first, ...rest]);
    }

SequenceExpression
  = first:SequenceItem
    rest:(SequenceGap item:SequenceItem { return item; })* {
      return sequence([first, ...rest]);
    }

SequenceItem
  = expression:(EnumeratedChordArithmetic / ShiftedValueExpression / ScaleDegreeLiteral / AdditiveExpression)
    marks:AttachedPostfixMark* {
      if (!marks.length) return expression;
      return node('PostfixExpression', { expression, marks });
    }

ShiftedValueExpression
  = modifiers:PitchModifier+ operand:(RatioLiteral / EqualDivisionLiteral / ScaleDegreeLiteral) {
      let result = operand;
      for (let index = modifiers.length - 1; index >= 0; index -= 1) {
        result = unary(modifiers[index].raw, result);
      }
      return result;
    }

EnumeratedChordArithmetic
  = first:EnumeratedChord
    multiplicative:(Spacing operator:MultiplicativeOperator Spacing right:PowerExpression {
      return { operator, right };
    })*
    additive:(
      operator:AttachedAdditiveOperator Spacing right:MultiplicativeExpression {
        return { operator, right };
      }
      / RequiredSpacing operator:AdditiveOperator Spacing right:MultiplicativeExpression {
        return { operator, right };
      }
    )* {
      return foldBinary(foldBinary(first, multiplicative), additive);
    }

AdditiveExpression
  = first:MultiplicativeExpression
    rest:(
      operator:AttachedAdditiveOperator Spacing right:MultiplicativeExpression {
        return { operator, right };
      }
      / RequiredSpacing operator:AdditiveOperator Spacing right:MultiplicativeExpression {
        return { operator, right };
      }
    )* {
      return foldBinary(first, rest);
    }

// Without whitespace before the operator, plus and minus are unambiguously
// arithmetic. In particular, `G-n3` and `M3-n3` must not be mistaken for a
// sequence whose second item is a unary-negated interval.
AttachedAdditiveOperator
  = "+" { return "+"; }
  / "-" { return "-"; }

AdditiveOperator
  = BinaryPlus
  / BinaryMinus

// A plus immediately followed by a digit belongs to the following signed
// integer. This mirrors binary minus so `0 +5` is a sequence item while
// `0 + 5` remains addition.
BinaryPlus
  = "+" ![0-9] { return "+"; }

// A minus immediately followed by a digit or named interval belongs to the
// following signed sequence item. This makes `-1 -2` a sequence of two
// negative integer leaves and `D -n3` a D followed by a descending neutral
// third. Whitespace after the minus keeps it binary, as in `D - n3`.
// Write arithmetic subtraction of integer literals as `-1/1 - 2/1` or put
// whitespace after the binary minus.
BinaryMinus
  = "-" !([0-9] / NamedIntervalStart) { return "-"; }

NamedIntervalStart
  = PitchModifier* IntervalQuality [0-9]

MultiplicativeExpression
  = first:PowerExpression
    rest:(Spacing operator:MultiplicativeOperator Spacing right:PowerExpression {
      return { operator, right };
    })* {
      return foldBinary(first, rest);
    }

MultiplicativeOperator
  = "*" { return "*"; }
  / BinaryDivide
  / "div"i !IdentifierContinue { return "div"; }
  / "mod"i !IdentifierContinue { return "mod"; }

// A slash attached to a pitch-like token is a lift modifier belonging to the
// following sequence item, not division (for example `Cv5 /'C`).
BinaryDivide
  = "/" !(PitchModifier / PitchNominal / [0-9]) { return "/"; }

PowerExpression
  = left:UnaryExpression
    tail:(
      "^" Spacing right:PowerExpression { return right; }
      / RequiredSpacing "^" RequiredSpacing right:PowerExpression { return right; }
    )? {
      return tail ? binary("^", left, tail) : left;
    }

UnaryExpression
  = PostfixExpression
  / operator:UnaryOperator Spacing operand:UnaryExpression {
      return unary(operator, operand);
    }

UnaryOperator
  = "+" { return "+"; }
  / "-" { return "-"; }

PostfixExpression
  = expression:PrimaryExpression marks:AttachedPostfixMark* {
      if (!marks.length) return expression;
      return node('PostfixExpression', { expression, marks });
    }

AttachedPostfixMark
  = "=" { return node('DetachedContinue', { raw: "=", attached: true }); }
  / marks:$("?"+) {
      return node('TailElimination', { count: marks.length, raw: marks });
    }

PrimaryExpression
  = RepeatExpression
  / PitchContextChange
  / Directive
  / NormalizedGroup
  / ParenthesizedExpression
  / Rest
  / DetachedContinue
  / Barline
  / EnumeratedChord
  / MonzoLiteral
  / IntervalLiteral
  / PitchLiteral
  / EqualDivisionLiteral
  / QuantityLiteral
  / RatioLiteral
  / RealLiteral
  / DecimalLiteral
  / IntegerLiteral
  / CallExpression
  / IdentifierExpression

// Colon chords are ratios relative to their first enumerand.  The leading
// slash takes reciprocals before that normalization, which is equivalent to
// reversing each resulting ratio.  Double colon fills in every intervening
// integer (in either direction).
EnumeratedChord
  = inverted:"/"? first:IntegerLiteral tail:(
      "::" last:ChordEnumerand { return { rangeEnd: last, enumerands: null }; }
      / rest:(":" value:ChordEnumerand { return value; })+ {
        return { rangeEnd: null, enumerands: [first, ...rest] };
      }
    ) !":" {
      return node('EnumeratedChord', {
        inverted: Boolean(inverted),
        first,
        enumerands: tail.enumerands,
        rangeEnd: tail.rangeEnd,
        raw: text(),
      });
    }

ChordEnumerand
  = ChordGroupedEnumerand
  / QuantityLiteral
  / RatioLiteral
  / RealLiteral
  / DecimalLiteral
  / IntegerLiteral
  / CallExpression
  / IdentifierExpression

ChordGroupedEnumerand
  = "(" Spacing expression:AdditiveExpression Spacing ")" {
      return node('Group', { expression });
    }

ParenthesizedExpression
  = "(" Spacing expression:ParallelExpression Spacing ")" {
      return node('Group', { expression });
    }

NormalizedGroup
  = "[" Spacing expression:ParallelExpression? Spacing "]" {
      return node('NormalizeToSlot', { expression: expression ?? null });
    }

MonzoLiteral
  = "[" Spacing components:MonzoComponents? Spacing ">@" subgroup:MonzoSubgroup? {
      return node('MonzoLiteral', {
        components: components ?? [],
        subgroup: subgroup?.components ?? [],
        continuation: subgroup?.continuation ?? true,
        raw: text(),
      });
    }

MonzoComponents
  = first:MonzoComponent rest:(RequiredSpacing value:MonzoComponent { return value; })* {
      return [first, ...rest];
    }

MonzoComponent
  = $(Sign? UnsignedInteger ("/" UnsignedInteger)?)

MonzoSubgroup
  = first:MonzoSubgroupComponent
    rest:("." !"." value:MonzoSubgroupComponent { return value; })*
    continuation:(".." { return true; })? {
      return { components: [first, ...rest], continuation: continuation ?? false };
    }

MonzoSubgroupComponent
  = $(UnsignedInteger ("/" UnsignedInteger)?)

Rest
  = raw:$("."+) { return node('Rest', { raw }); }

DetachedContinue
  = "=" { return node('DetachedContinue', { raw: "=" }); }

Barline
  = "|" !("|" / ":" / "@^" / [⁰¹²³⁴⁵⁶⁷⁸⁹]) { return node('Barline', { raw: "|" }); }

HardBoundary
  = "||" { return node('HardBoundary', { raw: "||" }); }

RepeatExpression
  = "|:" Spacing count:RepeatCount? Spacing body:RepeatBody? result:RepeatEndings {
      return node('Repeat', { count, body: body ?? [], endings: result.endings, terminal: result.terminal });
    }

RepeatEndings
  = Spacing firstNumber:FirstEndingMarker Spacing firstBody:EndingParallelExpression?
    rest:(Spacing number:NextEndingMarker Spacing body:EndingParallelExpression? {
      return { number, body: body ? [body] : [] };
    })*
    Spacing terminal:("||" / "|" / !. { return null; }) {
      return { endings: [{ number: firstNumber, body: firstBody ? [firstBody] : [] }, ...rest], terminal };
    }
  / Spacing ":|" { return { endings: [], terminal: ":|" }; }

EndingParallelExpression
  = first:EndingSequenceExpression
    rest:(Spacing "," Spacing branch:EndingSequenceExpression { return branch; })* {
      return parallel([first, ...rest]);
    }

EndingSequenceExpression
  = first:SequenceItem rest:(EndingSequenceGap item:SequenceItem { return item; })* {
      return sequence([first, ...rest]);
    }

EndingSequenceGap
  = RequiredSpacing !("|" Spacing)
  / &("|:" / "[" / "(" / "{")
  / &Rest
  / PreviousItemBoundary

FirstEndingMarker
  = "|" number:EndingNumber { return number; }

NextEndingMarker
  = ":|" number:EndingNumber { return number; }

EndingNumber
  = "@^" value:UnsignedInteger {
      return node('IntegerLiteral', { raw: value, value });
    }
  / value:SuperscriptUnsignedInteger {
      return node('IntegerLiteral', { raw: value.raw, value: value.value });
    }

RepeatBody
  = first:ParallelExpression?
    rest:(Spacing boundary:HardBoundary Spacing next:ParallelExpression? {
      return { boundary, next };
    })* {
      const body = [];
      if (first) body.push(first);
      for (const part of rest) {
        body.push(part.boundary);
        if (part.next) body.push(part.next);
      }
      return body;
    }

RepeatCount
  = "@x"i value:UnsignedInteger {
      return node('IntegerLiteral', { raw: value, value });
    }
  / "ˣ" value:SuperscriptUnsignedInteger {
      return node('IntegerLiteral', { raw: value.raw, value: value.value });
    }

Directive
  = "@" body:(GrooveDirectiveBody / ArticulationShorthandBody / NumericDirectiveBody / NamedDirectiveBody) {
      return node('Directive', body);
    }

GrooveDirectiveBody
  = name:$('groove'i) !IdentifierContinue "(" Spacing argument:SequenceExpression? Spacing ")" {
      return {
        name: 'groove',
        rawName: name,
        arguments: argument ? [argument] : [],
        graceCount: 0,
      };
    }

ArticulationShorthandBody
  = mark:$(['.':_\-]) {
      return {
        name: 'articulation-shorthand',
        rawName: '@' + mark,
        arguments: [],
        graceCount: 0,
        articulationMark: mark,
      };
    }

NumericDirectiveBody
  = value:(UnsignedRatioLiteral / UnsignedRealLiteral / UnsignedDecimalLiteral / UnsignedIntegerLiteral)
    grace:$([?]*) {
      return {
        name: 'subdivision',
        arguments: [value],
        graceCount: grace.length,
        rawName: '@' + value.raw + grace,
      };
    }

NamedDirectiveBody
  = name:Identifier args:DirectiveArguments? {
      return {
        name: name.toLowerCase(),
        rawName: name,
        arguments: args ?? [],
        graceCount: 0,
      };
    }

DirectiveArguments
  = "(" Spacing args:DirectiveArgumentList? Spacing ")" {
      return args ?? [];
    }

DirectiveArgumentList
  = first:DirectiveArgument
    rest:(Spacing "," Spacing argument:DirectiveArgument { return argument; })* {
      return [first, ...rest];
    }

DirectiveArgument
  = name:Identifier Spacing ":" Spacing value:AdditiveExpression {
      return node('NamedArgument', { name, value });
    }
  / AdditiveExpression

PitchContextChange
  = "{" Spacing preset:ContextPreset Spacing "}" {
      return node('PitchContextChange', {
        statements: [node('ContextPreset', preset)],
      });
    }
  / "{" Spacing statements:ContextStatementList Spacing "}" {
      return node('PitchContextChange', { statements });
    }
  / "{" Spacing expression:ParallelExpression Spacing "}" {
      return node('PitchContextChange', {
        statements: [node('ContextDegreeMapping', { values: [expression] })],
      });
    }
  / "{" Spacing "}" {
      return node('PitchContextChange', { statements: [] });
    }

ContextStatementList
  = first:ContextStatement
    rest:(Spacing ";" Spacing statement:ContextStatement { return statement; })* {
      return [first, ...rest];
    }

ContextStatement
  = name:$('root'i) !IdentifierContinue Spacing "=" Spacing
    value:(ShiftedValueExpression / ScaleDegreeLiteral) {
      return node('ContextAssignment', {
        target: node('ContextNameTarget', { name: name.toLowerCase() }),
        value,
      });
    }
  / target:ContextAssignmentTarget Spacing "=" Spacing value:ContextValue {
      return node('ContextAssignment', { target, value });
    }
  / preset:ContextPreset {
      return node('ContextPreset', preset);
    }

ContextAssignmentTarget
  = operator:ContextOperatorTarget {
      return node('ContextOperatorTarget', { operator });
    }
  / pitch:PitchLiteral {
      return node('ContextPitchTarget', { pitch });
    }
  / name:Identifier {
      return node('ContextNameTarget', { name });
    }

ContextOperatorTarget
  = $("^" / "v" / "/" / "\\")

ContextValue
  = MappingLiteral
  / AdditiveExpression

MappingLiteral
  = "<" Spacing first:AdditiveExpression
    rest:(SequenceGap value:AdditiveExpression { return value; })*
    Spacing close:("]" / ">") {
      return node('MappingLiteral', {
        values: [first, ...rest],
        closingDelimiter: close,
      });
    }

ContextPreset
  = raw:$(UnsignedInteger "ed"i (RatioText / UnsignedInteger)) !IdentifierContinue {
      return { kind: 'equalDivision', raw };
    }
  / raw:$(
      [a-zA-Z]+ UnsignedInteger ("edo"i / [a-zA-Z]*)
      / UnsignedInteger ("edo"i / [a-zA-Z]+)
    ) !IdentifierContinue {
      return { kind: 'rank1', raw };
    }

CallExpression
  = callee:Identifier Spacing "(" Spacing args:CallArgumentList? Spacing ")" {
      return node('CallExpression', { callee, arguments: args ?? [] });
    }

CallArgumentList
  = first:AdditiveExpression
    rest:(Spacing "," Spacing argument:AdditiveExpression { return argument; })* {
      return [first, ...rest];
    }

IdentifierExpression
  = name:Identifier {
      return node('Identifier', { name });
    }

IntervalLiteral
  = modifiers:PitchModifier* quality:IntervalQuality number:IntervalNumber
    inflections:FjsInflection* !IdentifierContinue {
      return node('IntervalLiteral', {
        modifiers,
        quality,
        number,
        inflections,
        raw: text(),
      });
    }

IntervalQuality
  = $("S" "A"+ / "s" "d"+ / "A"+ / "d"+ / "P" / "M" / "m" / "n")

IntervalNumber
  = $(UnsignedInteger (".5" / "½")?)

PitchLiteral
  = nominal:PitchNominal
    accidentals:PythagoreanAccidental*
    inflections:FjsInflection* !IdentifierContinue {
      return node('PitchLiteral', {
        modifiers: [],
        nominal,
        accidentals,
        inflections,
        raw: text(),
      });
    }
  / modifiers:PitchModifier+ nominal:PitchNominal
    accidentals:PythagoreanAccidental*
    inflections:FjsInflection* !IdentifierContinue {
      return node('PitchLiteral', {
        modifiers,
        nominal,
        accidentals,
        inflections,
        raw: text(),
      });
    }

// Bare integer tokens in score position are scale degrees, not scalar integer
// expressions. They intentionally stop before binary operators so `2 - 3`
// remains an integer subtraction expression while `2 -3` remains a sequence of
// degrees.
ScaleDegreeLiteral
  = sign:Sign? degree:UnsignedInteger !NumericLiteralSuffix !IdentifierContinue !BinaryOperatorAfterSpacing {
      return node('DegreeLiteral', {
        modifiers: [],
        degree: sign === '-' ? sign + degree : degree,
        raw: text(),
      });
    }

NumericLiteralSuffix
  = "/" / "\\" / "." [0-9]+ ("e" / "r" / UnitSuffix)

BinaryOperatorAfterSpacing
  = Spacing (AdditiveOperator / MultiplicativeOperator / "^")

PitchModifier
  = raw:$("'" / '"' / "`" / "^" / "v" / "/" / "\\") {
      return node('PitchModifier', { kind: modifierKind(raw), raw });
    }

PitchNominal
  = value:$("alp"i / "bet"i / "gam"i / "del"i / "eps"i / "zet"i / "eta"i) {
      return node('PitchNominal', { system: 'greek', value });
    }
  / value:$([A-Ga-g]) {
      return node('PitchNominal', { system: 'latin', value });
    }
  / value:$([J-Zj-z]) {
      return node('PitchNominal', { system: 'mos', value });
    }
  / value:$([Α-Ηα-η]) {
      return node('PitchNominal', { system: 'greek', value });
    }

// The underscore belongs exclusively to the Pythagorean natural accidental;
// denominator FJS inflections use the postfix `v` marker.
PythagoreanAccidental
  = value:$("𝄪" / "𝄫" / "𝄲" / "𝄳" / "𝄬" / "𝄭" / "𝄮" / "𝄯" / "𝄰" / "𝄱" / [x♯#‡t♮d♭bpq]) {
      return node('Accidental', { value });
    }
  / "_" ![0-9] { return node('Accidental', { value: '_' }); }

FjsInflection
  = marker:$("^" / "v") prime:UnsignedInteger flavor:$([cnqthm])? {
      return node('FjsInflection', {
        direction: marker === '^' ? 'numerator' : 'denominator',
        marker,
        prime,
        flavor: flavor ?? '',
        raw: marker + prime + (flavor ?? ''),
      });
    }

EqualDivisionLiteral
  = sign:Sign? body:UnsignedEqualDivisionLiteral {
      if (!sign) return body;
      return node('EqualDivisionLiteral', {
        ...body,
        sign,
        raw: sign + body.raw,
      });
    }

UnsignedEqualDivisionLiteral
  = steps:UnsignedInteger "\\" divisions:UnsignedInteger equave:EquaveSuffix? {
      return node('EqualDivisionLiteral', {
        steps,
        divisions,
        equave: equave ?? null,
        raw: text(),
      });
    }

EquaveSuffix
  = "<" Spacing value:AdditiveExpression Spacing ">" { return value; }

QuantityLiteral
  = sign:Sign? magnitude:UnsignedDecimalOrInteger unit:UnitSuffix {
      return node('QuantityLiteral', {
        sign: sign ?? null,
        magnitude,
        unit,
        raw: text(),
      });
    }

UnitSuffix
  = value:$("kHz"i / "Hz"i / "ms"i / "dB"i / "beats"i / "beat"i / "s"i / "c" / "%") {
      return value;
    }

RatioLiteral
  = sign:Sign? body:UnsignedRatioLiteral {
      if (!sign) return body;
      return node('RatioLiteral', {
        ...body,
        sign,
        raw: sign + body.raw,
      });
    }

UnsignedRatioLiteral
  = numerator:UnsignedInteger "/" denominator:UnsignedInteger {
      return node('RatioLiteral', {
        numerator,
        denominator,
        raw: text(),
      });
    }

RatioText
  = $(UnsignedInteger "/" UnsignedInteger)

DecimalLiteral
  = sign:Sign? body:UnsignedDecimalLiteral {
      if (!sign) return body;
      return node('DecimalLiteral', {
        ...body,
        sign,
        raw: sign + body.raw,
      });
    }

UnsignedDecimalLiteral
  = value:$([0-9]+ "." [0-9]+) "e" !IdentifierContinue {
      return node('DecimalLiteral', { value, raw: text() });
    }

RealLiteral
  = sign:Sign? body:UnsignedRealLiteral {
      if (!sign) return body;
      return node('RealLiteral', {
        ...body,
        sign,
        raw: sign + body.raw,
        value: sign + body.value,
      });
    }

UnsignedRealLiteral
  = value:$([0-9]+ "." [0-9]+) "r" !IdentifierContinue {
      return node('RealLiteral', { value, raw: text() });
    }

IntegerLiteral
  = sign:Sign? body:UnsignedIntegerLiteral {
      if (!sign) return body;
      return node('IntegerLiteral', {
        ...body,
        sign,
        raw: sign + body.raw,
        value: sign + body.value,
      });
    }

UnsignedIntegerLiteral
  = value:UnsignedInteger !IdentifierContinue {
      return node('IntegerLiteral', { value, raw: value });
    }

UnsignedDecimalOrInteger
  = $([0-9]+ ("." [0-9]*)?)

UnsignedInteger
  = $([0-9]+)

SuperscriptUnsignedInteger
  = raw:$([⁰¹²³⁴⁵⁶⁷⁸⁹]+) {
      const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
      return { raw, value: [...raw].map(character => digits.indexOf(character)).join("") };
    }

Sign
  = $("+" / "-")

Identifier
  = $([A-Za-z_] IdentifierContinue*)

IdentifierContinue
  = [A-Za-z0-9_]

SequenceGap
  = RequiredSpacing
  // Structural notation separates adjacent sequence items without requiring
  // whitespace on either side (`C[D E]F`, `{13edo}C`, and `E|:F G:||`).
  / &("|:" / Barline / "[" / "(" / "{")
  / &Rest
  / PreviousItemBoundary

// Peggy has no lookbehind predicate. This zero-width rule recognizes
// continues, bars, rests, and structural closers immediately before the gap.
// The closing brace is escaped because it would end the semantic predicate.
PreviousItemBoundary
  = &{ return offset() > 0 && "=).]|\u007d".includes(input[offset() - 1]); }

Spacing
  = (White / Comment)*

RequiredSpacing
  = (White / Comment)+

White
  = [ \t\r\n]

Comment
  = raw:$("#" [^\r\n]*) { return rememberComment(raw); }
