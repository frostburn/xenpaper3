# Xenpaper source characters

This inventory describes characters recognized by the Xenpaper parser, not characters that may
appear in comments. The Basic Latin block is listed in full so that unsupported ASCII characters
are explicit. Outside Basic Latin, only recognized characters are listed.

“Identifier” below means an ASCII identifier (`[A-Za-z_][A-Za-z0-9_]*`). Keywords, directive
names, units, named operators, interval qualities, and pitch names give some letters additional
context-dependent meanings.

## Basic Latin

| Character code | Text     | Usage                                                                                                                                                    |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U+0000–U+0008  | _NUL–BS_ | Unsupported                                                                                                                                              |
| U+0009         | _HT_     | Whitespace                                                                                                                                               |
| U+000A         | _LF_     | Whitespace; ends a comment                                                                                                                               |
| U+000B–U+000C  | _VT–FF_  | Unsupported                                                                                                                                              |
| U+000D         | _CR_     | Whitespace; ends a comment                                                                                                                               |
| U+000E–U+001F  | _SO–US_  | Unsupported                                                                                                                                              |
| U+0020         | _SP_     | Whitespace                                                                                                                                               |
| U+0021         | !        | Unsupported                                                                                                                                              |
| U+0022         | "        | Double-equave-up pitch modifier                                                                                                                          |
| U+0023         | #        | Sharp accidental; starts a line comment                                                                                                                  |
| U+0024         | $        | Unsupported                                                                                                                                              |
| U+0025         | %        | Percent quantity suffix                                                                                                                                  |
| U+0026         | &        | MOS chroma-up accidental                                                                                                                                 |
| U+0027         | '        | Equave-up pitch modifier; MOS large-step assignment target                                                                                               |
| U+0028         | (        | Starts a group, argument/parameter list, or MOS UDP period                                                                                               |
| U+0029         | )        | Ends a group, argument/parameter list, or MOS UDP period                                                                                                 |
| U+002A         | *        | Multiplication; doubled as the exponentiation operator `**`                                                                                              |
| U+002B         | +        | Unary plus; addition; positive numeric sign                                                                                                              |
| U+002C         | ,        | Parallel composition; list and vector component separator                                                                                                |
| U+002D         | -        | Unary negation; subtraction; negative numeric sign; identifier continuation in gliss curve names                                                         |
| U+002E         | .        | Rest; decimal point; monzo subgroup separator and continuation marker; articulation shorthand                                                            |
| U+002F         | /        | Lift pitch modifier; ratio slash; spaced division; inverted enumerated chord; logdivision operator `/_`; monzo component fraction                        |
| U+0030–U+0039  | 0–9      | Scale degrees and numeric literals; identifier continuation                                                                                              |
| U+003A         | :        | Enumerated-chord separator (`:` or `::`); repeat delimiters `\|:` and `:\|`; named directive argument and MOS hardness separator; articulation shorthand |
| U+003B         | ;        | Context and MOS statement separator                                                                                                                      |
| U+003C         | <        | Opens an equal-division equave suffix, mapping, or MOS equave                                                                                            |
| U+003D         | =        | Assignment; note continuation/hold postfix                                                                                                               |
| U+003E         | >        | Closes an equal-division equave suffix, mapping, MOS equave, or monzo (`>@`)                                                                             |
| U+003F         | ?        | Note-tail elimination; subdivision grace marker                                                                                                          |
| U+0040         | @        | Directive prefix; MOS chroma-down accidental; monzo subgroup marker; repeat count/ending prefix; articulation shorthand                                  |
| U+0041         | A        | Latin pitch A; augmented interval quality; identifier                                                                                                    |
| U+0042         | B        | Latin pitch B; decibel unit as part of `dB`; identifier                                                                                                  |
| U+0043         | C        | Latin pitch C; identifier                                                                                                                                |
| U+0044         | D        | Latin pitch D; identifier                                                                                                                                |
| U+0045         | E        | Latin pitch E; identifier                                                                                                                                |
| U+0046         | F        | Latin pitch F; identifier                                                                                                                                |
| U+0047         | G        | Latin pitch G; identifier                                                                                                                                |
| U+0048         | H        | Hertz unit as part of `Hz`/`kHz`; identifier                                                                                                             |
| U+0049         | I        | Identifier                                                                                                                                               |
| U+004A–U+005A  | J–Z      | Diamond-MOS pitch nominal; identifier (with `M`, `P`, and `S` also used in interval qualities)                                                           |
| U+005B         | [        | Starts a normalized slot or monzo vector                                                                                                                 |
| U+005C         | \        | Drop pitch modifier; equal-division separator                                                                                                            |
| U+005D         | ]        | Ends a normalized slot or mapping                                                                                                                        |
| U+005E         | ^        | Up pitch modifier; numerator FJS inflection marker; context/MOS assignment target                                                                        |
| U+005F         | _        | Natural or MOS natural accidental; identifier; logdivision operator `/_`; articulation shorthand                                                         |
| U+0060         | `        | Equave-down pitch modifier                                                                                                                               |
| U+0061         | a        | Latin pitch A; MOS half-chroma-down accidental; identifier/FJS flavor                                                                                    |
| U+0062         | b        | Latin pitch B or flat accidental; identifier                                                                                                             |
| U+0063         | c        | Latin pitch C; cents unit; identifier/FJS flavor                                                                                                         |
| U+0064         | d        | Latin pitch D or half-flat accidental; diminished interval quality; identifier                                                                           |
| U+0065         | e        | Latin pitch E; MOS half-chroma-up accidental; exact-decimal suffix; identifier                                                                           |
| U+0066         | f        | Latin pitch F; identifier                                                                                                                                |
| U+0067         | g        | Latin pitch G; identifier                                                                                                                                |
| U+0068         | h        | Half-interval suffix; identifier/FJS flavor                                                                                                              |
| U+0069–U+006B  | i–k      | Identifier                                                                                                                                               |
| U+006C         | l        | Identifier/FJS flavor                                                                                                                                    |
| U+006D         | m        | Minor interval quality; unit text such as `ms`; identifier/FJS flavor                                                                                    |
| U+006E         | n        | Neutral interval quality; identifier/FJS flavor                                                                                                          |
| U+006F         | o        | Identifier                                                                                                                                               |
| U+0070         | p        | Po accidental; identifier                                                                                                                                |
| U+0071         | q        | Qu accidental; identifier/FJS flavor                                                                                                                     |
| U+0072         | r        | Inexact-real suffix; identifier                                                                                                                          |
| U+0073         | s        | Semi-diminished interval quality; seconds and other unit text; MOS small-step assignment/pattern; identifier/FJS flavor                                  |
| U+0074         | t        | Half-sharp accidental; identifier/FJS flavor                                                                                                             |
| U+0075         | u        | Identifier                                                                                                                                               |
| U+0076         | v        | Down pitch modifier or Diamond-MOS nominal; denominator FJS inflection marker; identifier                                                                |
| U+0077         | w        | Identifier                                                                                                                                               |
| U+0078         | x        | Double-sharp accidental; repeat-count text as part of `@x`; identifier                                                                                   |
| U+0079–U+007A  | y–z      | Identifier                                                                                                                                               |
| U+007B         | {        | Starts a pitch-context, MOS declaration, or function body                                                                                                |
| U+007C         | \|       | Barline/hard boundary; repeat delimiter; MOS UDP separator                                                                                               |
| U+007D         | }        | Ends a pitch-context, MOS declaration, or function body                                                                                                  |
| U+007E         | ~        | Unary tempering operator                                                                                                                                 |
| U+007F         | _DEL_    | Unsupported                                                                                                                                              |

## Other recognized characters

| Character code                               | Text        | Usage                                                                                   |
| -------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| U+00A2                                       | ¢           | Cents quantity suffix (for example, `700¢`)                                             |
| U+00B2–U+00B3, U+00B9, U+2070, U+2074–U+2079 | ² ³ ¹ ⁰ ⁴–⁹ | Superscript digits in numerator FJS inflections and repeat-ending numbers               |
| U+00BD                                       | ½           | Half-integer interval-number suffix (for example, `P4½`)                                |
| U+02E3                                       | ˣ           | Superscript repeat-count prefix (for example, `\|:ˣ³`)                                  |
| U+0391–U+0397                                | Α–Η         | Uppercase Greek pitch nominals alpha through eta                                        |
| U+03B1–U+03B7                                | α–η         | Lowercase Greek pitch nominals alpha through eta                                        |
| U+1E7D                                       | ṽ           | Unambiguous lowercase Diamond-MOS `v` nominal; may be doubled                           |
| U+2021                                       | ‡           | Half-sharp accidental                                                                   |
| U+2080–U+2089                                | ₀–₉         | Subscript digits in denominator FJS inflections                                         |
| U+221A                                       | √           | Unary square-root operator                                                              |
| U+2227                                       | ∧           | Up pitch modifier                                                                       |
| U+2228                                       | ∨           | Down pitch modifier                                                                     |
| U+266D                                       | ♭           | Flat accidental                                                                         |
| U+266E                                       | ♮           | Natural accidental                                                                      |
| U+266F                                       | ♯           | Sharp accidental                                                                        |
| U+27E8                                       | ⟨           | Opens a mapping (val)                                                                   |
| U+27E9                                       | ⟩           | Closes a monzo vector; unlike ASCII `>`, requires `@` only when a subgroup follows      |
| U+1D12A                                      | 𝄪           | Double-sharp accidental                                                                 |
| U+1D12B                                      | 𝄫           | Double-flat accidental                                                                  |
| U+1D12C–U+1D131                              | 𝄬 𝄭 𝄮 𝄯 𝄰 𝄱 | HEJI flat-up, flat-down, natural-up, natural-down, sharp-up, and sharp-down accidentals |
| U+1D132                                      | 𝄲           | Half-sharp accidental                                                                   |
| U+1D133                                      | 𝄳           | Half-flat accidental                                                                    |

Greek letters theta through omega are not reserved pitches: only alpha through eta, in either
case, are pitch nominals.
