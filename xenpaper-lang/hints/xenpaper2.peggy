{
  const node = (type, extra = {}) => ({ type, delimiter: false, ...extra, location: location() });
}

Start = seq:Sequence _ {
  return node('XenpaperGrammar', { sequence: seq });
}
Sequence = items:ItemList { return node('Sequence', { items }); }
ItemList = head:Item tail:(_ Item)* { return [head, ...tail.map(([,i]) => i)]; } / '' { return []; }
Item = Comment / MusicalControlFlow / SetterGroup / SetRoot / SetScale / SetMos / RatioChordItem / SampleRateNote / Note / Rest / Chord / RepeatEndStart / RepeatStart / RepeatEnd / RepeatEndingStart / BarLine / Whitespace
Note = pitch:Pitch tail:PlayableTail? {
  return node('Note', { pitch, tail });
}
SampleRateNote = "!" tail:Tail? {
  return node('SampleRateNote', { tail });
}
SampleRatePitch = "!" { return node('SampleRateNote', { tail: null }); }
Pitch
 = octave:OctaveModifier? value:(PitchCents / PitchHz / PitchOctaveDivision / TemperedPitchRatio / PitchRatio) {
  return node('Pitch', { octave, value });
}
 / prefix:PitchPrefix value:(TemperedPitchRatio / PitchRatio) {
  return node('Pitch', { octave: prefix.octave, value: { ...value, ups: prefix.ups, lifts: prefix.lifts } });
}
 / prefix:PitchPrefix value:(PitchAbsolute / PitchDegree) {
  return node('Pitch', { octave: prefix.octave, value: { ...value, ups: value.ups + prefix.ups, lifts: value.lifts + prefix.lifts } });
}
 / value:(PitchAbsolute / PitchDegree) {
  return node('Pitch', { octave: null, value });
}
PitchPrefix = parts:PitchPrefixPart+ {
  const { octave, ups, lifts } = parts.reduce((sum, part) => ({
    octave: sum.octave + part.octave,
    ups: sum.ups + part.ups,
    lifts: sum.lifts + part.lifts,
  }), { octave: 0, ups: 0, lifts: 0 });
  return {
    octave: octave === 0 ? null : node('OctaveModifier', { octave }),
    ups,
    lifts,
  };
}
PitchPrefixPart
 = shift:(Apostrophe / Quote / Grave) { return { octave: shift, ups: 0, lifts: 0 }; }
 / updown:UpDown { return { octave: 0, ...updown }; }
OctaveModifier = shifts:(Apostrophe / Quote / Grave)+ {
  const octave = shifts.reduce((sum, shift) => sum + shift, 0);
  return node('OctaveModifier', { octave });
}
Apostrophe "apostrophe" = "'" { return 1; }
Quote "quote" = '"' { return 2; }
Grave "grave" = "`" { return -1; }
UpDown = '^' { return { ups: 1, lifts: 0 }; } / 'v' { return { ups: -1, lifts: 0 }; } / '/' { return { ups: 0, lifts: 1 }; } / '\\' { return { ups: 0, lifts: -1 }; }
LatinNominal = nominal:[a-g]i { return { nominal, nominalType: 'latin' } }
MosNominal = nominal:$([j-z]i+) { return { nominal, nominalType: 'mos' } }
GreekNominal "Greek nominal" = ([α-ω]i / "alp"i / "bet"i / "gam"i / "del"i / "eps"i / "zet"i / "eta"i / "the"i / "iot"i / "kap"i / "muu"i / "nuu"i / "xii"i / "omi"i / "pii"i / "rho"i / "fsi"i / "sig"i / "tau"i / "ups"i / "phi"i / "chi"i / "psi"i / "ome"i) {
  return { nominal: text(), nominalType: 'greek' };
}
Accidental "accidental" = ReservedAccidental / '𝄪' / '𝄫' / '𝄲' / '𝄳' / '𝄬' / '𝄭' / '𝄮' / '𝄯' / '𝄰' / '𝄱' / [x♯#‡t♮_d♭bpq]
ReservedAccidental = accidental:[acefg] {
  error(`Accidental '${accidental}' is reserved for future use.`);
}
UpsAndDowns "Ups and Downs" = updowns:UpDown* {
  return updowns.reduce((sum, updown) => ({
    ups: sum.ups + updown.ups,
    lifts: sum.lifts + updown.lifts,
  }), { ups: 0, lifts: 0 });
}
InflectionFlavor = 'n' / 'l' / 'h' / 'm' / 's' / 'f' / 'c' / 'q' / 't' / ''
Inflection "inflection" = type: ('^' / 'v') value: Int flavor: InflectionFlavor {
  return {
    type: type === '^' ? 'superscript' : 'subscript',
    value,
    flavor
  };
}
PitchAbsolute
 = PitchAbsoluteReservedAccidental
 / updowns: UpsAndDowns nominal: (GreekNominal / LatinNominal) accidentals: Accidental* inflections: Inflection* { return node('PitchAbsolute', {...updowns, ...nominal, accidentals, inflections}) }
 / PitchAbsoluteMos
PitchAbsoluteReservedAccidental = UpsAndDowns (GreekNominal / LatinNominal) ReservedAccidental
PitchAbsoluteMos
 = updowns: UpsAndDowns nominal:MosNominal accidentals:MosAccidental* { return node('PitchAbsolute', {...updowns, ...nominal, accidentals, inflections: []}) }
MosAccidental = [\&@ea♮_]
PitchCents = cents:Number "c"i { return node('PitchCents',{cents}); }
PitchHz = hz:Number _ "hz"i { return node('PitchHz',{hz}); }
PitchOctaveDivision = numerator:Int [\\/] denominator:Int suffix:PitchOctaveDivisionSuffix {
  return node('PitchOctaveDivision',{numerator,denominator,octaveSize:suffix.octaveSize,octaveSizeLabel:suffix.octaveSizeLabel});
} / numerator:Int "\\" denominator:Int { return node('PitchOctaveDivision',{numerator,denominator,octaveSize:2,octaveSizeLabel:null}); }
PitchOctaveDivisionSuffix = _ "ed"i _ os:OctaveSizeWithLabel? { return { octaveSize: os?.octaveSize ?? 2, octaveSizeLabel: os ? `<${os.label}>` : null }; }
  / _ "<" _ os:OctaveSizeWithLabel _ ">" { return { octaveSize: os.octaveSize, octaveSizeLabel: `<${os.label}>` }; }
OctaveSize = os:OctaveSizeWithLabel { return os.octaveSize; }
OctaveSizeWithLabel = fraction:Fraction {
  return {
    octaveSize: fraction.numerator / fraction.denominator,
    label: fraction.denominator === 1 ? `${fraction.numerator}` : `${fraction.numerator}/${fraction.denominator}`,
  };
}
TemperedPrefix = '~' { return node('TemperedPrefix', { delimiter: true }); }
PitchRatio = fraction:SlashFraction { return node('PitchRatio', fraction); }
TemperedPitchRatio = prefix:TemperedPrefix fraction:SlashFraction { return node('PitchRatio', { ...fraction, tempered: true, temperedPrefix: prefix }); }
PitchDegree = updowns:UpsAndDowns degree:Int {
  return node('PitchDegree',{...updowns, degree});
}
Tail = _? hold:Hold { return hold; }
Hold = first:HoldPart rest:(_ HoldPart)* {
  const parts = [first, ...rest.map(([, part]) => part)];
  const length = parts.filter((part) => part.type === 'HoldDash').length;
  return node('Hold', { length, parts });
}
HoldPart = HoldDash / BarLineInHold
BarLineInHold = bar:BarLine &("|"* _ "-") { return bar; }
HoldDash = "-" { return node('HoldDash'); }
Rest = "." { return node('Rest', { length: 1 }); }
PitchGroup = first:Pitch rest:(Whitespace Pitch)* {
  const result = [first];
  for (const pair of rest) {
    result.push(pair[0], pair[1]);
  }
  return result;
}
ChordPitch = Pitch / SampleRatePitch
ChordRatioChordPitches = temperedPrefix:TemperedPrefix? &("/"? Int _ ":" !"|") inversionPrefix:InversionPrefix? pitches:RatioChordPitches {
  return [
    ...(temperedPrefix ? [temperedPrefix] : []),
    ...(inversionPrefix ? [inversionPrefix] : []),
    ...pitches.map((pitch) => pitch.type === 'RatioChordPitch' ? { ...pitch, ...(inversionPrefix ? { inverted: true } : {}), ...(temperedPrefix ? { tempered: true } : {}) } : pitch),
  ];
}
ChordPitchElement = ChordRatioChordPitches / ChordPitch
ChordPitchSeparator = Whitespace / &ChordPitchElement { return node('Whitespace', { delimiter: true }); }
ChordPitchGroup = first:ChordPitchElement rest:(ChordPitchSeparator ChordPitchElement)* {
  const result = Array.isArray(first) ? [...first] : [first];
  for (const pair of rest) {
    result.push(pair[0], ...(Array.isArray(pair[1]) ? pair[1] : [pair[1]]));
  }
  return result;
}
InversionPrefix = "/" { return node('InversionPrefix', { delimiter: true }); }
RatioChordPitch = n:Int { return node('RatioChordPitch', { pitch: n }); }
Colon = ":" { return node('Colon', { delimiter: true }); }
RatioChordPitches = first:RatioChordPitch rest:((_ Colon _)+ RatioChordPitch)* {
  const result = [first];
  for (const part of rest) {
    const colons = part[0].map(([, colon]) => colon);
    const pitch = part[1];
    result.push(...colons, pitch);
  }
  return result;
}
RatioChord = temperedPrefix:TemperedPrefix? inversionPrefix:InversionPrefix? pitches:RatioChordPitches tail:PlayableTail? {
  return node('RatioChord', {
    ...(temperedPrefix ? { tempered: true, temperedPrefix } : {}),
    ...(inversionPrefix ? { inverted: true, inversionPrefix } : {}),
    pitches: pitches.map((pitch) => pitch.type === 'RatioChordPitch' ? { ...pitch, ...(inversionPrefix ? { inverted: true } : {}), ...(temperedPrefix ? { tempered: true } : {}) } : pitch),
    tail,
  });
}
RatioChordItem = &('~'? "/"? Int _ ":" !"|") rc:RatioChord { return rc; }
Chord = temperedPrefix:TemperedPrefix? "[" _ pitches:ChordPitchGroup _ "]" tail:PlayableTail? {
  return node('Chord', { pitches: temperedPrefix ? pitches.map((pitch) => pitch.type === 'Pitch' && pitch.value.type === 'PitchRatio' ? { ...pitch, value: { ...pitch.value, tempered: true } } : pitch.type === 'RatioChordPitch' ? { ...pitch, tempered: true } : pitch) : pitches, tail, ...(temperedPrefix ? { tempered: true, temperedPrefix } : {}) });
}
RepeatEndStart = ":|:" count:RepeatCount? {
  return node('RepeatEndStart',{delimiter:true, repeatCount: count ?? 2});
}
RepeatStart = "|:" count:RepeatCount? { return node('RepeatStart',{delimiter:true, repeatCount: count ?? 2}); }
RepeatEnd = ":|" alternateEnding:RepeatEndingNumber? tail:Tail? {
  return node('RepeatEnd',{delimiter:true, alternateEnding, tail});
}
RepeatEndingStart = "|" ending:RepeatEndingNumber tail:Tail? {
  return node('RepeatEndingStart',{delimiter:true, alternateEnding: ending, tail});
}
RepeatCount = "ˣ" count:SuperScriptInt { return count; } / "(" "x"i count:Int ")" { return count; }
RepeatEndingNumber = SuperScriptInt / "(" "^" count:Int ")" { return count; }
BarLine = "|" { return node('BarLine',{delimiter:true}); }
MusicalControlFlow =
  "(" _ "segno"i _ ")" { return node('Segno', { delimiter: true }); }
  / "(" _ "coda"i _ ")" { return node('Coda', { delimiter: true }); }
  / "(" _ "fine"i _ ")" { return node('Fine', { delimiter: true }); }
  / "(" _ DaCapoToken _ "al"i _ "fine"i _ ")" { return node('DaCapo', { delimiter: true, target: 'start', stop: 'fine' }); }
  / "(" _ DaCapoToken _ "al"i _ "coda"i _ ")" { return node('DaCapo', { delimiter: true, target: 'start', stop: 'coda' }); }
  / "(" _ DalSegnoToken _ "al"i _ "fine"i _ ")" { return node('DalSegno', { delimiter: true, target: 'segno', stop: 'fine' }); }
  / "(" _ DalSegnoToken _ "al"i _ "coda"i _ ")" { return node('DalSegno', { delimiter: true, target: 'segno', stop: 'coda' }); }
  / "(" _ ("to"i / "al"i) _ "coda"i _ ")" { return node('AlCoda', { delimiter: true }); }
DaCapoToken = "d"i "."? _ "c"i "."? / "da"i _ "capo"i
DalSegnoToken = "d"i "."? _ "s"i "."? / "dal"i _ "segno"i
Semicolon = _ ";" _ { return node('Semicolon', { delimiter: true }); }
Drone = "drone"i _ ":" _ value:("off"i { return null; } / RatioChordItem / SampleRateNote / Note / Chord) {
  return node('Drone', { value });
}
SetterGroup = "(" _ first:Setter rest:(Semicolon Setter)* _ ")" {
  const setters = [first];
  for (const part of rest) setters.push(part[0], part[1]);
  return node('SetterGroup', { setters });
}
Setter = SetBpm / SetBms / SetTime / SetGrace / SetGliss / SetArticulation / SetTempoRamp / SetVolumeRamp / SetGroove / SetSubdivision / Drone / SetUp / SetLift / SetOsc / SetNoise / SetEnv / SetVolume / SetVelocity / SetKey / SetSignature / SetRulerRange / SetRulerPlot / SetVelocityShorthand
SetBpm = "bpm"i _ ":" _ bpm:Number { return node('SetBpm', { bpm }); }
SetBms = "bms"i _ ":" _ bms:Number { return node('SetBms', { bms }); }
SetTime = "time"i _ ":" _ numerator:Int _ "/" _ denominator:Int { return node('SetTime', { numerator, denominator }); }
SetSubdivision = ("div"i _ ":" _)? fraction:Fraction {
  return node('SetSubdivision', {
    subdivision: fraction.numerator,
    denominator: fraction.denominator,
  });
}
SetGroove = "groove"i _ ":" _ items:GrooveItem* { return node('SetGroove', { items: items.flat() }); }
GrooveItem = GrooveSetterGroup / SetArticulation / SetSubdivision / SampleRateNote / Whitespace
GrooveSetterGroup = "(" _ first:GrooveGroupedSetter rest:(Semicolon GrooveGroupedSetter)* _ ")" {
  const items = [first];
  for (const part of rest) items.push(part[0], part[1]);
  return items;
}
GrooveGroupedSetter = SetArticulation / SetVelocity / SetVelocityShorthand / SetSubdivision
SetGliss = "gliss"i easing:(_ @GlissEasing)? {
  return node('SetGliss', { easing: (easing ?? 'linear').toLowerCase() });
}
SetArticulation
  = ("articulation"i / "art"i) _ ":" _ percent:Number _ "%" { return node('SetArticulation', { articulation: percent / 100 }); }
  / ("staccatissimo"i / "'") { return node('SetArticulation', { articulation: 0.25 }); }
  / ("staccato"i / ".") { return node('SetArticulation', { articulation: 0.5 }); }
  / ("portato"i / ":") { return node('SetArticulation', { articulation: 0.85 }); }
  / ("tenuto"i / "-") { return node('SetArticulation', { articulation: 1 }); }
  / ("legato"i / "_") { return node('SetArticulation', { articulation: 1.1 }); }
GlissEasing = $([a-zA-Z0-9-]+)
SetVolumeRamp = kind:('cresc'i / 'dim'i / 'vramp'i) easing:(_ @GlissEasing)? {
  return node('SetVolumeRamp', { kind: kind.toLowerCase(), easing: (easing ?? 'linear').toLowerCase() });
}
SetTempoRamp = kind:('accel'i / 'rall'i / 'tramp'i) easing:(_ @GlissEasing)? {
  return node('SetTempoRamp', { kind: kind.toLowerCase(), easing: (easing ?? 'linear').toLowerCase() });
}
PlayableTail = Tail / ZeroDuration
ZeroDuration = "?" { return node('Hold', { length: -1, parts: [] }); }
SetGrace = data:(("grace"i _ ":" _ fraction:Fraction count:(_ @Int)? { return { fraction, count: count ?? 1 }; }) / (fraction:Fraction _ questionMarks:$("?"+) { return { fraction, count: questionMarks.length }; })) {
  return node('SetGrace', {
    subdivision: data.fraction.numerator,
    denominator: data.fraction.denominator,
    count: data.count,
  });
}
SetUp = "^" _ ":" _ value:Pitch { return node('SetUp', { value }); }
SetLift = "/" _ ":" _ value:Pitch { return node('SetLift', { value }); }
SetOsc = "osc"i _ ":" _ osc:OscName { return node('SetOsc', { osc }); }
OscName "oscillator name" = [a-zA-Z0-9\-]+ { return text().toLowerCase(); }
SetNoise = "noise"i _ ":" _ noise:NoiseName interpolation: (_ @InterpolationName)? { return node('SetNoise', { noise, interpolation }); }
NoiseName "noise generator name" = [a-zA-Z0-9\-]+ { return text().toLowerCase(); }
InterpolationName "noise interpolation type" = [a-zA-Z0-9\-]+ { return text().toLowerCase(); }
SetEnv = "env"i _ ":" _ vals:EnvValues {
  return node('SetEnv', vals);
}
SetVolume = "vol"i _ ":" _ db:SignedNumber _ "db"i { return node('SetVolume', { db }); }
SetVelocity = "vel"i _ ":" _ percent:Number _ "%" { return node('SetVelocity', { velocity: percent / 100 }); }
SetVelocityShorthand = shorthand:VelocityShorthand { return node('SetVelocity', { velocity: shorthand }); }
VelocityShorthand
  = "ppp"i { return 0.1; }
  / "pp"i { return 0.2; }
  / "p"i { return 0.3; }
  / "mp"i { return 0.4; }
  / "mf"i { return 0.5; }
  / "fff"i { return 1; }
  / "ff"i { return 0.8; }
  / "f"i { return 0.6; }
SetKey
  = "key"i _ ":" _ tonic:KeyTonic _ mode:KeyMode { return node('SetKey', { tonic, mode, keyType: 'pythagorean' }); }
  / "key"i _ ":" _ tonic:MosKeyTonic expressions:MosKeyExpressionItem* { return node('SetKey', { tonic, expressions, keyType: 'mos' }); }
SetSignature = "sig"i _ ":" items:SignatureItem* { return node('SetSignature', { items }); }
SignatureItem = _ value:(KeyTonic / MosKeyTonic) { return value; }
KeyTonic = updowns:UpsAndDowns nominal:(GreekNominal / LatinNominal) accidentals:Accidental* inflections:Inflection* { return { ...updowns, ...nominal, accidentals, inflections }; }
MosKeyTonic = updowns:UpsAndDowns nominal:MosNominal accidentals:MosAccidental* { return { ...updowns, ...nominal, accidentals }; }
MosKeyExpressionItem = _ value:(MosMode) { return node('MosExpression', { value }); }
KeyMode
  = "major"i { return "ionian"; }
  / "ionian"i { return "ionian"; }
  / "dorian"i { return "dorian"; }
  / "phrygian"i { return "phrygian"; }
  / "lydian"i { return "lydian"; }
  / "mixolydian"i { return "mixolydian"; }
  / "minor"i { return "aeolian"; }
  / "aeolian"i { return "aeolian"; }
  / "locrian"i { return "locrian"; }
EnvValues "four digits" = a:EnvDigit _ d:EnvDigit _ s:EnvDigit _ r:EnvDigit { return { a, d, s, r }; }
EnvDigit = digit:[0-9] { return parseInt(digit, 10); }
SetRulerRange = "rl"i _ ":" _ low:Pitch _ "," _ high:Pitch { return node('SetRulerRange', { low, high }); }
SetRulerPlot
  = "plot"i _ ":" _ nominalType:PlotNominalType { return node('SetRulerPlot', { nominalType }); }
  / "plot"i { return node('SetRulerPlot', { nominalType: null }); }
PlotNominalType
  = "latin"i { return 'latin'; }
  / "greek"i { return 'greek'; }
  / "mos"i { return 'mos'; }
SetRoot = "{" _ "r"i body:(RootNominalOnly / RootPitch) _ "}" { return node('SetRoot', body); }
RootPitch = _ pitch:Pitch rootNominal:RootNominal? { return { pitch, rootNominal }; }
RootNominalOnly = rootNominal:RootNominal { return { pitch: null, rootNominal }; }
RootNominal = RootNominalPrefix @RootNominalValue
RootNominalPrefix = _ "as"i _
RootNominalValue = octave:OctaveModifier? nominal:PitchAbsolute {
  return { ...nominal, octave: octave?.octave ?? 0, location: location() };
}

SetMos = "MOS"i _ "{" expressions:MosExpressionItem* _ "}" {
  return node('SetMos', { expressions });
}
MosExpressionItem = _ value:MosExpression { return node('MosExpression', { value }); }
MosExpression
  = MosRationalEquave
  / MosUp
  / MosLift
  / MosMode
  / MosHardness
  / MosCountLarge
  / MosCountSmall
  / MosLongIntegerPattern
  / MosSmallIntegerPattern
  / MosAbstractStepPattern
MosRationalEquave = "<" _ numerator:Int denominator:(_ "/" _ @Int)? _ ">" { return { type: 'MosRationalEquave', numerator, denominator: denominator ?? 1 }; }
MosAbstractStepPattern = pattern:$([Ls]+) { return { type: 'MosAbstractStepPattern', pattern }; }
MosSmallIntegerPattern = pattern:$([0-9]+) { return { type: 'MosIntegerPattern', pattern: pattern.split('').map(d => parseInt(d, 10)) }; }
MosLongIntegerPattern = pattern:Int _ "," _ rest:(_ @Int _ ","? _)* { return { type: 'MosIntegerPattern', pattern: [pattern, ...rest] }; }
MosHardness = numerator:Int _ ":" _ denominator:Int { return { type: 'MosHardness', numerator, denominator }; }
MosCountLarge = count:Int _ "L"i { return { type: 'MosCountLarge', count }; }
MosCountSmall = count:Int _ "s"i { return { type: 'MosCountSmall', count }; }
MosMode = up:Int _ "|" _ down:Int _ period:("(" _ @Int _ ")")? { return { type: 'MosMode', up, down, period }; }
MosUp = "^" up:Int { return { type: 'MosUp', up}; }
MosLift = "/" lift:Int { return { type: 'MosLift', lift}; }

SetScale = "{" _ scale:(EdoScale / CustomMappingScale / PythagoreanScale / PitchGroupScale) _ "}" {
  return node('SetScale', { scale });
}
EdoScale = divisions:Int _ "ed"i "o"i? _ octaveSize:OctaveSize? {
  return node('EdoScale', { divisions, octaveSize: octaveSize ?? 2 });
}
PythagoreanScale = "pythagorean"i { return node('PythagoreanScale') };
CustomMappingScale = ("<" / "⟨") _ entries:CustomMappingEntryList _ "]" anchor:(_ "@" _ @Int)? {
  return node('CustomMappingScale', { entries, anchor: anchor ?? null });
}
CustomMappingEntryList = first:CustomMappingEntry rest:((_ ","? _) @CustomMappingEntry)* {
  return [first, ...rest];
}
CustomMappingEntry = cents:Number _ "c"i { return { value: cents, unit: 'cents' }; } / steps:Number { return { value: steps, unit: 'steps' }; }
ScaleOctaveMarker = "'" { return node('ScaleOctaveMarker'); }
PitchGroupScalePrefix = p:"m"i _ {
  return node('PitchGroupScalePrefix', { prefix: p.toLowerCase() });
}
PitchGroupScale = pitchGroupScalePrefix:PitchGroupScalePrefix? pitches:ChordPitchGroup _ scaleOctaveMarker:ScaleOctaveMarker? {
  return node('PitchGroupScale', {
    pitchGroupScalePrefix,
    pitches,
    scaleOctaveMarker,
  });
}
Comment = "#" comment:$([^\n\r]*) {
  return node('Comment', { comment });
}
Whitespace "whitespace" = [,\n\r\t ]+ { return node('Whitespace',{delimiter:true}); }
SignedNumber "number" = sign:("+" / "-")? n:Number { return sign === "-" ? -n : n; }
Number "number" = n:$([0-9]+ ("." [0-9]*)?) { return Number(n); }
Fraction = numerator:Int denominator:(_ "/" _ @Int)? { return { numerator, denominator: denominator ?? 1 }; }
SlashFraction = numerator:Int "/" denominator:Int { return { numerator, denominator }; }
Int "integer" = n:$([0-9]+) { return parseInt(n, 10); }
SuperScriptInt "superscript integer" = digits:SuperScriptDigit+ { return parseInt(digits.join(''), 10); }
SuperScriptDigit = "⁰" { return '0'; } / "¹" { return '1'; } / "²" { return '2'; } / "³" { return '3'; } / "⁴" { return '4'; } / "⁵" { return '5'; } / "⁶" { return '6'; } / "⁷" { return '7'; } / "⁸" { return '8'; } / "⁹" { return '9'; }
_ "whitespace" = [ \t\n\r]*
