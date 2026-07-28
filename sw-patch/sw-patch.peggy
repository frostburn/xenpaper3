{
  const indentStack = [""];

  function node(type, fields = {}, loc = location()) {
    return { type, ...fields, location: loc };
  }

  function atLineStart(pos = offset()) {
    return pos === 0 || input[pos - 1] === "\n" || input[pos - 1] === "\r";
  }

  function readIndent(pos = offset()) {
    let end = pos;
    while (input[end] === " " || input[end] === "\t") end += 1;
    return input.slice(pos, end);
  }

  function indentWidth(indent) {
    let width = 0;
    for (const char of indent) width += char === "\t" ? 4 : 1;
    return width;
  }

  function currentIndent() {
    return indentStack[indentStack.length - 1];
  }

  function resetIndent() {
    indentStack.length = 1;
    indentStack[0] = "";
  }

  function isCurrentIndent() {
    return atLineStart() && readIndent() === currentIndent();
  }

  function isChildIndent() {
    if (!atLineStart()) return false;
    const parent = currentIndent();
    const child = readIndent();
    return child.startsWith(parent)
      && indentWidth(child) > indentWidth(parent);
  }

  function pushIndent(indent) {
    indentStack.push(indent);
  }

  function popIndent() {
    if (indentStack.length > 1) indentStack.pop();
  }

  function foldBinary(head, tail) {
    return tail.reduce(
      (left, [operator, right]) => node("BinaryExpression", {
        operator,
        left,
        right,
      }),
      head,
    );
  }

  function applyPostfix(head, tails) {
    return tails.reduce((value, tail) => {
      if (tail.kind === "member") {
        return node("MemberExpression", {
          object: value,
          property: tail.property,
        });
      }

      return node("CallExpression", {
        callee: value,
        arguments: tail.arguments,
      });
    }, head);
  }
}

Start
  = &{ resetIndent(); return true; }
    BOM? lines:(BlankLine / TopStatementLine)* H EndOfFile {
      return node("Program", {
        body: lines.filter((line) => line !== null),
      });
    }

TopStatementLine
  = &{ return currentIndent() === ""; }
    statement:StatementLine {
      return statement;
    }

StatementLine
  = CurrentIndent statement:StatementBody {
      return statement;
    }

StatementBody
  = CompoundStatement
  / statement:SimpleStatement LineEnd { return statement; }

CompoundStatement
  = FunctionDeclaration
  / UntilStatement
  / IfStatement
  / ElifStatement
  / ElseStatement

FunctionDeclaration
  = returned:(KeywordRet __ { return true; })?
    once:(KeywordOnce __ { return true; })?
    KeywordFn __ name:Identifier H parameters:Parameters body:Suite {
      return node("FunctionDeclaration", {
        name,
        parameters,
        once: once ?? false,
        returned: returned ?? false,
        body,
      });
    }

Parameters
  = "(" W values:ParameterList? W ")" { return values ?? []; }

ParameterList
  = head:Parameter tail:(W "," W @Parameter)* W ","? {
      return [head, ...tail];
    }

Parameter
  = name:Identifier annotation:TypeAnnotation
    defaultValue:(H "=" H @Expression)? {
      return node("Parameter", {
        name,
        annotation,
        defaultValue: defaultValue ?? null,
      });
    }

UntilStatement
  = KeywordUntil __ event:Expression body:Suite {
      return node("UntilStatement", { event, body });
    }

IfStatement
  = KeywordIf __ test:Expression body:Suite {
      return node("IfStatement", { test, body });
    }

ElifStatement
  = KeywordElif __ test:Expression body:Suite {
      return node("ElifStatement", { test, body });
    }

ElseStatement
  = KeywordElse body:Suite {
      return node("ElseStatement", { body });
    }

Suite
  = H ":" H InlineComment? EOL BlankLine*
    &{ return isChildIndent(); }
    indent:$([ \t]+)
    &{
      pushIndent(indent);
      return true;
    }
    first:(StatementBody / &{ popIndent(); return false; })
    rest:(BlankLine / StatementLine)* {
      popIndent();
      return [first, ...rest.filter((line) => line !== null)];
    }

SimpleStatement
  = TypeAlias
  / ConfigDeclaration
  / TypedBinding
  / ScheduledStatement
  / ConnectionStatement
  / AssignmentStatement
  / ReturnStatement
  / DocStringStatement
  / CommentStatement
  / ExpressionStatement

TypeAlias
  = KeywordType __ name:Identifier H "=" H value:TypeExpression {
      return node("TypeAlias", { name, value });
    }

ConfigDeclaration
  = KeywordConfig __ name:Identifier annotation:TypeAnnotation? H "=" H value:Expression {
      return node("ConfigDeclaration", { name, annotation, value });
    }
  / KeywordConfig __ name:Identifier H ":" H EOL
    [ \t]+ annotation:TypeExpression H "=" H value:Expression {
      return node("ConfigDeclaration", { name, annotation, value });
    }

TypedBinding
  = name:Identifier annotation:TypeAnnotation H "=" H value:Expression {
      return node("TypedBinding", { name, annotation, value });
    }

TypeAnnotation
  = H ":" H value:TypeExpression { return value; }

ScheduledStatement
  = "@" schedule:ScheduleSpec __ statement:SchedulableStatement {
      return node("ScheduledStatement", {
        at: schedule.at,
        automation: schedule.automation,
        statement,
      });
    }

ScheduleSpec
  = "(" W at:Expression W automation:(";" W @AutomationSpec)? W ")" {
      return { at, automation: automation ?? null };
    }
  / at:PostfixExpression {
      return { at, automation: null };
    }

AutomationSpec
  = KeywordLinear { return node("LinearAutomation"); }
  / KeywordExponential { return node("ExponentialAutomation"); }
  / KeywordHold { return node("HoldAutomation"); }
  / KeywordCancel { return node("CancelAutomation"); }
  / KeywordTarget __ timeConstant:Expression {
      return node("TargetAutomation", { timeConstant });
    }

SchedulableStatement
  = AssignmentStatement
  / ConnectionStatement
  / ExpressionStatement

ConnectionStatement
  = first:Expression
    rest:(H connection:ConnectionOperator H target:Expression {
      return [connection, target];
    })+ {
      return node("ConnectionStatement", {
        first,
        links: rest.map(([connection, target]) => ({ ...connection, target })),
      });
    }

ConnectionOperator
  = "!->" { return { operator: "disconnect" }; }
  / "->" { return { operator: "connect" }; }
  / "-" output:[0-9]+ input:("," @([0-9]+))? ">" {
      return {
        operator: "connect",
        output: Number(output.join("")),
        input: input === null ? 0 : Number(input.join("")),
      };
    }

AssignmentStatement
  = target:Assignable H "=" !"=" H value:Expression {
      return node("AssignmentStatement", { target, value });
    }

ReturnStatement
  = KeywordRet __ value:Expression {
      return node("ReturnStatement", { value });
    }

Assignable
  = value:PostfixExpression &{
      return value.type === "Identifier"
        || value.type === "MemberExpression";
    } { return value; }

ExpressionStatement
  = expression:Expression {
      return node("ExpressionStatement", { expression });
    }

DocStringStatement
  = value:TripleQuotedString {
      return node("DocStringStatement", { value });
    }

CommentStatement
  = value:Comment {
      return node("CommentStatement", { value });
    }

TypeExpression
  = TypeUnion

TypeUnion
  = head:TypePrimary tail:(TW "|" TW @TypePrimary)* {
      return tail.length === 0
        ? head
        : node("UnionType", { types: [head, ...tail] });
    }

TypePrimary
  = TypeGeneric
  / TypeObject
  / TypeStringLiteral
  / TypeName
  / "(" TW value:TypeExpression TW ")" { return value; }

TypeGeneric
  = callee:TypeName TW "<" TW argument:TypeExpression TW ">" {
      return node("GenericType", { callee, argument });
    }

TypeObject
  = "{" TW fields:TypeFieldList? TW "}" {
      return node("ObjectType", { fields: fields ?? [] });
    }

TypeFieldList
  = head:TypeField tail:(TypeFieldSeparator @TypeField)* TypeFieldSeparator? {
      return [head, ...tail];
    }

TypeField
  = name:Name TW ":" TW value:TypeExpression {
      return node("TypeField", { name, value });
    }

TypeFieldSeparator
  = TW "," TW
  / LineBreaks

TypeStringLiteral
  = value:StringLiteral {
      return node("StringLiteralType", { value });
    }

TypeName
  = name:QualifiedIdentifier {
      return node("TypeName", { name });
    }

Expression
  = LogicalOrExpression

LogicalOrExpression
  = head:LogicalAndExpression
    tail:(H KeywordOr H right:LogicalAndExpression {
      return ["or", right];
    })* {
      return foldBinary(head, tail);
    }

LogicalAndExpression
  = head:ComparisonExpression
    tail:(H KeywordAnd H right:ComparisonExpression {
      return ["and", right];
    })* {
      return foldBinary(head, tail);
    }

ComparisonExpression
  = head:AdditiveExpression
    tail:(H operator:ComparisonOperator H right:AdditiveExpression {
      return [operator, right];
    })* {
      return foldBinary(head, tail);
    }

ComparisonOperator
  = "<=" / ">=" / "==" / "!=" / "<" / ">"

AdditiveExpression
  = head:MultiplicativeExpression
    tail:(H operator:AdditiveOperator H right:MultiplicativeExpression {
      return [operator, right];
    })* {
      return foldBinary(head, tail);
    }

AdditiveOperator
  = "+"
  / "-" !([0-9]+ ("," [0-9]+)? ">")

MultiplicativeExpression
  = head:UnaryExpression
    tail:(H operator:("*" / "/" / "%") H right:UnaryExpression {
      return [operator, right];
    })* {
      return foldBinary(head, tail);
    }

UnaryExpression
  = operator:("+" / "-" / "!") H argument:UnaryExpression {
      return node("UnaryExpression", { operator, argument });
    }
  / KeywordNot __ argument:UnaryExpression {
      return node("UnaryExpression", { operator: "not", argument });
    }
  / PostfixExpression

PostfixExpression
  = head:PrimaryExpression tails:PostfixPart* {
      return applyPostfix(head, tails);
    }

PostfixPart
  = H "." H property:Name {
      return { kind: "member", property };
    }
  / H args:Arguments {
      return { kind: "call", arguments: args };
    }

Arguments
  = "(" W values:ArgumentList? W ")" {
      return values ?? [];
    }

ArgumentList
  = head:Argument tail:(ArgumentSeparator @Argument)* ArgumentSeparator? {
      return [head, ...tail];
    }

ArgumentSeparator
  = W "," W
  / LineBreaks

Argument
  = name:Name H "=" !"=" H value:Expression {
      return node("NamedArgument", { name, value });
    }
  / value:Expression {
      return node("PositionalArgument", { value });
    }

PrimaryExpression
  = UnitLiteral
  / NumberLiteral
  / BooleanLiteral
  / NullLiteral
  / StringLiteralExpression
  / ObjectLiteral
  / ListLiteral
  / IdentifierExpression
  / "(" W value:Expression W ")" { return value; }

ObjectLiteral
  = "{" W entries:ObjectEntryList? W "}" {
      return node("ObjectLiteral", { entries: entries ?? [] });
    }

ObjectEntryList
  = head:ObjectEntry tail:(ObjectEntrySeparator @ObjectEntry)* ObjectEntrySeparator? {
      return [head, ...tail];
    }

ObjectEntry
  = key:Name W ":" W value:Expression {
      return node("ObjectEntry", { key, value });
    }

ObjectEntrySeparator
  = W "," W
  / LineBreaks

ListLiteral
  = "[" W elements:ExpressionList? W "]" {
      return node("ListLiteral", { elements: elements ?? [] });
    }

ExpressionList
  = head:Expression tail:(W "," W @Expression)* W ","? {
      return [head, ...tail];
    }

UnitLiteral
  = value:Decimal spacing:H unit:UnitName {
      return node("UnitLiteral", {
        value,
        unit,
        spaced: spacing.length > 0,
      });
    }

UnitName
  = value:("beats"i / "beat"i / "bpm"i / "kHz"i / "Hz"i / "ms"i / "us"i / "ns"i / "dB"i / "s"i / "c"i / "%")
    !IdentifierContinue {
      return value.toLowerCase();
    }

NumberLiteral
  = value:Decimal {
      return node("NumberLiteral", { value });
    }

Decimal
  = value:$(
      ([0-9]+ ("." [0-9]*)? / "." [0-9]+)
      ([eE] [+-]? [0-9]+)?
    ) { return value; }

BooleanLiteral
  = KeywordTrue { return node("BooleanLiteral", { value: true }); }
  / KeywordFalse { return node("BooleanLiteral", { value: false }); }

NullLiteral
  = KeywordNull { return node("NullLiteral", { value: null }); }

StringLiteralExpression
  = value:StringLiteral {
      return node("StringLiteral", { value });
    }

StringLiteral
  = SingleQuotedString
  / DoubleQuotedString

SingleQuotedString
  = "'" chars:SingleStringCharacter* "'" { return chars.join(""); }

SingleStringCharacter
  = "\\" value:EscapeSequence { return value; }
  / ![\\'\r\n] value:. { return value; }

DoubleQuotedString
  = '"' chars:DoubleStringCharacter* '"' { return chars.join(""); }

DoubleStringCharacter
  = "\\" value:EscapeSequence { return value; }
  / ![\\"\r\n] value:. { return value; }

EscapeSequence
  = "n" { return "\n"; }
  / "r" { return "\r"; }
  / "t" { return "\t"; }
  / "\\" { return "\\"; }
  / '"' { return '"'; }
  / "'" { return "'"; }

TripleQuotedString
  = '\"\"\"' value:$((!'\"\"\"' .)*) '\"\"\"' { return value; }
  / "'''" value:$((!"'''" .)*) "'''" { return value; }

IdentifierExpression
  = name:Identifier {
      return node("Identifier", { name });
    }

QualifiedIdentifier
  = head:Identifier tail:("." @Identifier)* {
      return [head, ...tail].join(".");
    }

Name
  = value:$([A-Za-z_] [A-Za-z0-9_]*) { return value; }

Identifier
  = !ReservedWord value:Name { return value; }

ReservedWord
  = ("type" / "config" / "fn" / "once" / "until" / "ret" / "if" / "elif" / "else"
    / "and" / "or" / "not" / "true" / "false" / "null"
    / "linear" / "exponential" / "hold" / "cancel" / "target") !IdentifierContinue

IdentifierContinue
  = [A-Za-z0-9_]

KeywordType = "type" !IdentifierContinue
KeywordConfig = "config" !IdentifierContinue
KeywordFn = "fn" !IdentifierContinue
KeywordOnce = "once" !IdentifierContinue
KeywordUntil = "until" !IdentifierContinue
KeywordRet = "ret" !IdentifierContinue
KeywordIf = "if" !IdentifierContinue
KeywordElif = "elif" !IdentifierContinue
KeywordElse = "else" !IdentifierContinue
KeywordAnd = "and" !IdentifierContinue
KeywordOr = "or" !IdentifierContinue
KeywordNot = "not" !IdentifierContinue
KeywordTrue = "true" !IdentifierContinue
KeywordFalse = "false" !IdentifierContinue
KeywordNull = "null" !IdentifierContinue
KeywordLinear = "linear" !IdentifierContinue
KeywordExponential = "exponential" !IdentifierContinue
KeywordCancel = "cancel" !IdentifierContinue
KeywordHold = "hold" !IdentifierContinue
KeywordTarget = "target" !IdentifierContinue

CurrentIndent
  = &{ return isCurrentIndent(); } [ \t]*

BlankLine
  = [ \t]* EOL { return null; }

LineEnd
  = H InlineComment? (EOL / &EndOfFile)

LineBreaks
  = (H InlineComment? EOL [ \t]*)+

InlineComment
  = Comment

Comment
  = "#" value:$([^\r\n]*) { return value; }

H "horizontal whitespace"
  = $([ \t]*)

__ "horizontal whitespace"
  = [ \t]+

W "whitespace"
  = (WhiteSpace / Comment)*

TW "type whitespace"
  = (WhiteSpace / Comment)*

WhiteSpace
  = [ \t\r\n]+

EOL
  = "\r\n" / "\n" / "\r"

BOM
  = "\uFEFF"

EndOfFile
  = !.
