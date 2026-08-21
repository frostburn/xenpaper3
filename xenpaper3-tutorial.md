# Xenpaper 3 tutorial

These short, self-contained sidebars introduce Xenpaper from its basic score syntax through advanced microtonal notation. Try each example in order if you are new to the language; experienced users can jump directly to a topic.

A few conventions recur throughout the examples:

- Degree `0` is the current root, and the default scale is 12edo.
- An unadorned note or rest occupies one current subdivision. Each `=` extends it by one more subdivision.
- Spaces and line breaks usually have the same meaning. Bar lines are organizational unless a repeat or parallel section gives them special meaning.
- Settings such as scales, roots, dynamics, and articulation remain active until changed, but only within their current scope. See **Advanced score construction** for the scope boundaries.

# Basics

## Notes, rests, and duration

Typing a number creates a note. Notes can be separated by spaces or new lines.
```
0 4 7
11 12
```

Append equal signs to extend a note, and use dots for rests. Pitches and rests may be adjacent, although spaces often improve readability.
```
0.2.3...3=2=0==.
```

Bar lines help organize the score without changing the timing. A leading `=` continues (ties) the preceding note across a bar line.
```
0 8 7=|0 8 7=|=5 4==
```

Notes can be written as scale degrees, ratios, cents, diatonic pitches, steps of equal temperaments, cycles per second and more.
```
0 7 1/1 3/2 0c 702c C G
0\19 11\19 262Hz 393Hz
```

Notes can be shifted up or down octaves. Primes (apostrophes) shift up and graves (backticks) shift down.
```
0=3='0='3="0='"0=`0=``0=
```

Play simultaneous pitches by putting a comma-separated expression in parentheses or square brackets. Square brackets without commas create tuplets instead (see **Timing**).
```
(3,7)=[5,8]=(0,3,7)==.[1/1,6/5,3/2]==.
```

Negative degrees are supported.
```
0 -1 1 0=
```

Chords can also be played by enumerating a colon-separated chord.
```
10:12:15===
```

## Comments
A `#` starts a comment that continues to the end of the line.
```
# a 7th chord
[0,4,7,10]==..

# a harmonic 7th chord
4:5:6:7==..
```

## Scales
Change the scale at any point with braces. The default is 12 equal divisions of the octave (12edo); a scale change affects the notes that follow it.
```
[0,4,7]=== {31edo}[0,10,18]===
```

Equal division equave size can be changed by replacing the “o” with a number or fraction.
```
{13ed3}0 1 2 3 4
```

A scale can also be built from individual pitch intervals. The listed entries become degrees 1 onward; degree 0 remains the root.
```
{9/8 5/4 4/3 3/2 5/3 15/8 2/1}
0 1 2 3 4 5 6 7=
```

The final listed pitch is also the equave. Degree indexing wraps through that equave, so the pattern continues beyond the entries shown.
```
{5/4 4/3 3/2}
0 1 2 3 4 5 6 7 8=
```

An enumerated chord can define a scale compactly. Its first member becomes degree 0, and its final enumeral determines the equave.
```
{12:14:16:18:21:24}
0 1 2 3 4 5 6 7=
```

Harmonic segments can be specified using two colons :: to enumerate a range.
```
{4::8}
0 1 2 3 4==
```

Enumerations can be retroverted by prefixing them with a slash.
```
{/6::3}
0 1 2 3==
```

Scales can reference the scale degrees at the moment they are encountered, which is useful for creating a subset of a scale.
```
{19edo}{3 6 8 11 14 17 19}
0 1 2 3 4 5 6 7=
```

All pitch values other than cycles per second are relative to a root note.
```
0 2 4={root=432Hz}0 2 4=
```

As each root pitch change is relative to the current root, multiple roots can be chained.
```
4 0= {root = 2} 4 0= {root = 2} 4 0=
```

Root changes can also switch octaves for a time.
```
4 0={root = '0}4 0={root = `0}4 0=
```

## Timing

Tuplets can be created by enclosing a sequence of notes inside square brackets.
```
0 2 7 [0 2 7] [0 2 3 5 7]
```

Holding a tuplet stretches it as a whole.
```
[0 2 7] [0 2 7]===
```

Set the number of subdivisions per beat with `@` followed by a positive number. For example, `@2` makes each plain note half a beat long; `@1/2` makes it two beats long.
```
@2 0 2 3 7 @3 0 2 3 7 @4 0 2 3 7 @1/2 0 2 3 7
```

## Chord roots

Enumerated chords can be shifted using arithmetic. The first enumeral defines where 1/1 falls.

```
4/3 * 4:5:6==
3/2 * 4:5:3==
5/4 * /6:5:4==
```

Note that asterisks `*` only mean pitch shifts when both operands are ratios. Using + to shift is more common.

```
4/3   + ~4:5:6==  # Ratio + tempered ratios
702c  + 4:5:3==   # Cents + ratios
17\53 + /6:5:4==  # Steps of equal temperaments + ratios
```

## Other equal temperaments

Use angle brackets to change the equave of steps of equal temperaments.

```
5\13<3> 5\13<3/2>
```

## Repeats

Everything between `|:` and `:|` is repeated twice by default. Alternate endings use `@^1` and `@^2`, or the equivalent superscript numerals attached to bar lines as below.

```
# Square little tune
|: 0 2 4 5 |¹ 7 5 4 2 :|² 7 11 12= |
12 11 9 7 | 5 4 2 -1 | 0=== ||
```

To add more repeats use @x followed by a number attached to the opening |:.
```
|:@x6
4:5:6
4:5:3 * 5/4
8:5:6 * 25/16
{root = 125/128}
:|
```

## Glissando

Use @gliss to slide legato into the next note and hold the target. Linear glissando is the default.
```
@gliss 0=== 7
```

Use ? on the target to make it zero-duration. Easing modes include linear, ease and ease-in/out/in-out.
```
@gliss(ease-in-out)11=== 12==
..
@gliss(ease-in)0=== 7?
..
@gliss(ease-out)9=== 5=
```

Chord glissandi pair voices by index, so each chord tone slides legato.
```
@gliss[0, 3, 7]==@gliss[0, 3, 7]
@gliss[0, 3, 9]==@gliss[0, 3, 9]
[2, 7, 10]===
```

## Articulation

Articulation setters change how long notes sound without changing the duration they occupy. Use percentages, named setters, or compact shorthands: @' @staccatissimo, @. @staccato, @: @portato, @- @tenuto, and @_ @legato.

```
@. 0 2 4 7 .
@: 0 2 4 7 .
@- 0 2 4 7 .
@_ 0 2 4 7 .
@art(75%) 0 2 4 7
```

## Grace notes

Use a grace setter before a note to make that note borrow a short duration from the following note. Repeat the ? marker to apply the same grace duration to multiple notes.

```
@8? 5 3= @16? 7 5=
@8?? 7 10 8==
@4? 10 12==
```

## Dynamics

Control synth velocity with directives such as `@f` and `@pp`, or specify it directly with `@velocity(...)`. Dynamic settings remain active until the next dynamic directive.
```
@mf 0==   # 50% (default)
@f 1==    # 65%
@ff 2==   # 82%
@fff 3==  # 100%

@velocity(70%) 1==  # Fine-grained control

@mp 0==    # 40%
@p -1==    # 30%
@pp -2==   # 20%
@ppp -3==  # 10%
```

## Drones

Use `@drone(...)` to sustain a note or chord behind subsequent music. A new drone replaces the old one; empty parentheses stop it.

```
@drone([0, 7]) 0 2 4 5
@drone(5) 7 5 4 2
@drone() 0===
```

## Parallel sections

Use the comma `,` to separate sections that you want to play in parallel and terminate the group with a double bar line.

```
{root = '0} @4
5 . 7  . 10 7 5 . 7  . 12 . 10 7 5  . |
0 . 10 . 7  5 7 . 12 5 7  . 10 . 12 . |,

@2
[0,4,7]==    [5,9,12]==     [3,7,10]= |
=   [2,7,12]==   [0,4,7,11,12]===     |,

{root = `0}
0= 0= | 5= 7= ||
```

## Groove
Set an uneven groove to play with a swung feel. Even divisions of the same span will be cyclically mapped to match it.
```
@2
# Straight
0 0 4 4 7 7 9 9 10 10 9 9 7 7 4 4 |
# Triplet swing
@groove([0=0]=)
0 0 4 4 7 7 9 9 10 10 9 9 7 7 4 4 |
# Quintuplet swing
@groove([0==0=]=)
0 0 4 4 7 7 9 9 10 10 9 9 7 7 4 4 |
# Back to straight rhythm
@groove
0 0 4 4 7 7 9 9 '0===     . . . . ||
```

More complex grooves can be set by using more than two notes.
```
@groove([0==0=0]==)
0 1 2   5 4 3 |
2 1 -1 -5 7 . |
5 4 5   . . . |
4 3 4   . . . |
@4 3  2 1 0 -1
  -3 -4== -5==|
0===== ...... ||
```

Groove patterns can include accent dynamics. Accent values stay in effect until the next accent and multiply each note velocity.
```
@4
@groove(@ff 0 0 @pp 0 @ff 0 0 @pp 0 @ff 0 @pp 0)
0  2  3 5   7  9 10 12
0  2  3 5   7  9 10 12
12 10 9 7   10 9 7  5
9  7  5 3   7  5 3  2
```

Groove patterns can also include articulation. Articulation values latch until the next articulation and shorten or lengthen each grooved note.
```
@groove([@: 0== @' 0=]=)
0  6 8 2  3 9 10 4 |
12 6 5 11 8 3 0=   ||
```

# Advanced score construction

These features are most useful once you are comfortable with notes, timing, and pitch contexts. They explain how larger expressions are evaluated and where settings take effect.

## Setting scopes

Settings are inherited by nested expressions, but changes made inside a parenthesized group, square-bracket tuplet, or parallel branch stay inside that construction. After the construction ends, the outer scale, root, subdivision, dynamic, articulation, groove, and other settings resume.

In this example, the group inherits `@p` and 12edo, temporarily switches to `@f` and 19edo, and then discards those changes. The final degree 7 is quiet and uses 12edo again.

```
@p {12edo}
0 2 (@f {19edo} 6 8) 7=
```

Tuplets create the same kind of boundary. Inside the brackets, `@3` controls the first four notes before `@2` changes the final pair. After the slot, the outer `@2` and `@p` settings resume.

```
@2 @p
0 [@3 @f 2 4 6 @2 5 3] 7 9
```

Each parallel branch also receives its own copy of the outer settings. A change in one branch affects neither its siblings nor the music following the parallel section.

```
@p ||
@f 0 4, @pp 7 11 ||
12===
```

By contrast, an ungrouped setting in the ordinary surrounding sequence remains active, including after a repeat. Use an explicit group when a change should be temporary.

## Groups, tuplets, and parallel expressions

Parentheses group an expression without rescaling its duration. Square brackets without a top-level comma normalize the entire contents into one rhythmic slot, producing a tuplet. A top-level comma creates parallel branches; the construction lasts as long as its longest branch, and shorter branches are padded with silence.

```
# Three ordinary beats
(0 2 4)
# Three notes fitted into one beat
[0 2 4]
# Two simultaneous branches lasting four beats
|| 0 2 4, [7, 11]=== ||
# Three ordinary beats after the parallel section
0 2 4
```

Commas nested inside a chord do not split the surrounding sequence. Use parentheses when you need to make the intended grouping explicit.

## Arithmetic over score shapes

Pitch arithmetic can broadcast over a whole sequence or chord. This makes interval patterns reusable without spelling every resulting pitch. The shapes of both operands must be compatible when both sides are score constructions.

```
# Transpose an interval sequence from G
G + [P1 M2 M3 P5]
# Transpose every member of a chord
F + [P1, M3, P5]===
```

# Diatonic notation
By default, Xenpaper 3 associates degree 0 and middle C with 12edo middle C below A4 = 440 Hz (about 261.626 Hz). Diatonic intervals themselves follow a pure 3/2 chain of fifths until a temperament is selected.

```
# Ascending Pythagorean Major scale
C= D E F G A B c=
# Descending Pythagorean Major
243/128 27/16 3/2 4/3 81/64 9/8 1/1=
..
# Ascending 12-TET Major
0= 2 4 5 7 9 11 12==
.
```

Lower-case nominals are always an octave above upper-case nominals. Primes and graves always refer to octaves.
```
# Minor pentatonic
`A `B D E G A B d e g a b 'd 'e 'g 'a=
```

## Staff clefs

The notation view supports treble and bass clef changes. Clef directives affect notation only, not pitch or playback.

```
@clef(treble) C D E F
@clef(bass) `C `D `E `F
```

Relative pitch offsets are supported too.

```
@3
C  P1 1/1       # Perfect unison
C# A1 2187/2048 # Augmented unison
Db m2 256/243   # Minor second
D  M2 9/8       # Major second
Eb m3 32/27     # Minor third
E  M3 81/64     # Major third
F  P4 4/3       # Perfect fourth
Gb d5 1024/729  # Diminished fifth
G  P5 3/2       # Perfect fifth
Ab m6 128/81    # Minor sixth
A  M6 27/16     # Major sixth
Bb m7 16/9      # Minor seventh
B  M7 243/128   # Major seventh
c  P8 2/1       # Perfect octave
```
Note how C# and Db are not the same pitch when tuned pure.

## Root association

You can change which nominal aligns with the root frequency.
```
# Keep the default 262 Hz root, but call it F
{root as F}
F A C 0
```



## Tempering

Tuning using an equal temperament like {31edo} automatically affects diatonic notation: C stays with the root, P5 becomes whatever is the closest approximation to 3/2 and the circle of fifths continues from there defining G, D, A, E etc. with increasing drift from Pythagorean intonation.

```
{31edo}
# ii-V-I
[D, F, A, C]==. [D, F, G, B]==. [C, E, G, c]==.
```

If the fifth is tuned very flat the process unfortunately swaps the directions of sharp and flat.
```
{23edo}
# Anti-minor sounds majorish
[`A, C,  E]==.
# Anti-major has a narrow third
[`A, C#, E]==.
```

It is recommended to use Ups and Downs i.e. the caret ^ and v when sharps and flats can be confusing.
```
{16edo}
# Anti-minor
[C, E,  G]==.
# Anti-major using a sensible inflection
[C, vE, G]==.
```

Use tilde ~ to temper ratios and enumerated chords.
```
{53edo} @p
# Overtones are locked together
5::15==
.
# Tempered shimmering
~5::15==
.

@mf
# Tempered chord
~[4/3, 7/3, 9/3, 11/3]==
.

# Tempered ratios
~1/1 ~13/10 ~3/2
```

## Key signatures

Key signatures can be set with `{key = G}` or modal names like `{key = D Dorian}`. Plain nominals receive the signature accidentals, while an explicit natural sign ♮ or underscore _ restores the unaltered nominal.
```
# G major sharpens F
{key = G}
G= A B c d e f g=
# Flat seventh to tonic
f_= g=
```

Custom key signatures allow you to attach ups, lifts, accidentals and inflections (see below) to plain nominals. A natural sign restores the original nominal.
```
# 5-limit Phrygian
{sig = Bbv5 Cv5 Fv5 Gv5}
`A `B C D E F G A= B_ A=
```

Use the pythagorean accidentals p/q (a.k.a. po and qu from Color notation) to jump between named pitches.
```
{`A as root}
# B becomes 10/9 while
# c takes the place of 9/8.
{sig = B^5 Cbp}
`A `B C D E F G A=
```

## FJS inflections

The Functional Just System lets you spell just intonation by tweaking the Pythagorean spine with small inflections. For example, the Pythagorean major third 81/64 becomes 5/4 by dividing by the syntonic comma 81/80. In FJS, `^5` indicates that prime 5 occurs in the target interval’s numerator; the symbol describes the prime spelling, not necessarily the direction of the pitch adjustment.
```
1/1 5/4 4/3 3/2 9/5  2/1 ..
C   E^5 F   G   Bbv5 c   ..
```

HEJI instead chooses the arrow by the inflection’s pitch direction and appends the flavor `h` to the prime. Consequently, the same 5-limit pitches use the opposite arrow from their FJS spellings.

```
1/1 5/4  4/3 3/2 9/5   2/1 ..
C   Ev5h F   G   Bb^5h c   ..
```

There's a plethora of different inflection commas used for different purposes. Xenpaper inherits from SonicWeave but syntax-wise only ^ and v are allowed. E.g. 48/35 has to be spelled P4v5v7.
```
{8::16}
0  1  2     3      4  5      6     7     8 ..
# FJS
C D E^5  F^11   G  Ab^13   Bb^7   B^5    c ..
# HEJI
C D Ev5h F^11h  G  Av13h   Bbv7h  Bv5h   c ..
# Neutral FJS
C D Ed^5n F‡^11n G  Ad^13n Bd^7n  Bd^5n  c ..
```
[List of comma flavors](https://github.com/xenharmonic-devs/sonic-weave/blob/main/documentation/commas.md)

Inflections respond to tempering.
```
# Harmonic seventh in JI
[G B^5 d f^7]== .

# Harmonic seventh in 19-TET
{19edo}
[G B^5 d f^7]== .
# i.e.
[11 17 22 26]== .
```

## Half-intervals

Every even equal temperament of the octave contains the semioctave √2 (i.e. 1\2 or 600c) while every odd edo (besides 1edo) has a good approximation to either the neutral third √3/√2 or the semifourth 2/√3.

Relative diatonic intervals support neutral qualities and half-integer interval numbers. On imperfect intervals, the neutral quality `n` lies halfway between minor and major; `n4` lies between P4 and A4, while `n5` lies between d5 and P5. Their absolute counterparts above C use half-accidentals: `n3` is `Ed`, `n4` is `Ft`, and `n5` is `Gd`. Half-integer numbers instead reach the interordinal nominals: `P4½` (or ASCII `P4.5`) above C is `Gam` (Gamma). Each line below plays the same pitch twice.

```
C + n3   Ed
C + n4   Ft
C + n5   Gd
C + P4½  Gam
C + P4.5 Γ
```

These are Pythagorean geometric midpoints under the default tuning: `n3` is √(3/2), while `P4½` is the semioctave √2. Like other relative intervals, they follow the active temperament.

Neutral chords fall exactly between minor and major.
```
[1/1, 32/27,     3/2]==.  # Pythagorean minor
[1/1, 6/5,       3/2]==.  # 5-limit minor
[1/1, 11/9,      3/2]==.  # 11-limit neutral
[1/1, sqrt(3/2), 3/2]==.  # true neutral
[1/1, 5/4,       3/2]==.  # 5-limit major
[1/1, 81/64,     3/2]==.  # Pythagorean major
```

Semiquartal chords can be fun to mess around with.
```
[1/1, 8/7,      4/3]==.  # inverted 6:7:8
[1/1, 4/3**1/2, 4/3]==.  # true semiquartal
[1/1, 7/6,      4/3]==.  # 6:7:8
```
Note that fractions in Xenpaper 3 are "vertical" and bind more strongly than exponentiation. (PEMDAS-like division is available as `div`).

The semi-octave is familiar from 12edo but can be used in other contexts as well.
```
4:5:6:7==.                      # harmonic 7th
[1/1, 5/4, 3/2, sqrt(25/8)]==.  # true √2 against the third
```

## Neutral tunings
When the closest approximation to 3/2 spans an even number of edosteps it often makes sense to use half-sharps (𝄲, ‡ or t) and half-flats (𝄳 or d) to reach the neutral third.
```
{10edo}
# All 10 notes (and the octave)
C Ct D Ed F F𝄲 G G‡ A B𝄳 c
```

```
{17edo}
# All 17 notes (and the octave)
C Ct Dd D Dt Ed E F Ft Gd G Gt Ad A At Bd B c
```

Key signatures support quartertones.
```
{key = C Locrian}
C F B e a 'd 'g
{key = Cd Locrian}
C F B e a 'd 'g
{key = Cb Locrian}
C F B e a 'd 'g
{key = Cdb Locrian}
C F B e a 'd 'g
```

## Even tunings
12edo hides scales that repeat twice every octave.
```
{12edo}
C D E F Gam Del Eps Zet c
..
C Eta D Alp E F Gam G Del A Eps Zet c
```

Unfortunately a semioctave above C falls exactly between F and G so we need a new nominal Gam (Gamma) for this purpose. (The fifthwards tritone F# may be tuned unpredictably and rarely matches the fourthwards tritone Gb.) Every interordinal nominal is related to a Latin nominal by a semioctave. Alp is a 1\2 below A, Bet is a 1\2 below B, Gam is a 1\2 above C, etc. to stay within the C to c range.

The scales retain much of their character in 22edo. Highlight colors help to differentiate Greek script from Latin. On the staff Greek notes obtain a triangle note-head.
```
{22edo}
C D E F Γ Δ Ε Ζ c
..
C Η D Α E F Γ G Δ A Ε Ζ c
```

Key signatures translate across semioctaves.
```
{key = F major}
F Zet G eta A alp
# Both B and Bet become flat
B bet

c gam d del e eps f Zet F=
```

## Semiquartal tunings
When the closest approximation to 4/3 spans an even number of edosteps you may combine half-accidentals with interordinals to reach the semifourth.
```
{19edo}
C D Alpd Betd F G Deld Epsd Bb c
```

```
{53edo}
# Barbados[9]
c d αd βd f g δd εd bb 'c
```

## Custom Ups and Lifts

The Ups-and-Downs inflection is customizable.

```
# Make ups septimal
{^ = 64/63}
# Down-minor is 6:7:9
[`A vC E]== .
# Up-major is 14:18:21
[`A ^C# E]== .
```

By default a tempered lift is worth 5 ups, but can be configured separately.
```
{311edo}
# Make lifts septendecimal
{/ = 4\311}
# ~9:12:16:17
[C F Bb /cb]===
```

Ups and lifts attach to numeric scale degrees too.
```
{^ = 1\24; / = 5\25}
0 ^0 1 v2 2 /0
```

## Recovering Just Intonation

Automatic tempering can be undone by setting the scale to {Pythagorean} or {JI}.
```
{5edo}
C D F G A c
{Pythagorean}
C D F G A c
```

5-limit intervals are available using syntonic accidentals 𝄬, 𝄭, 𝄮, 𝄯, 𝄰 and 𝄱 which adjust pitch by 81/80.
```
# 4:5:6 on C
[C, E𝄯, G]==
```

7-limit intervals use the jubilismic √(50/49) lift slash / and the drop backslash \ to turn interordinals back into just intonation.
```
# 5:6:7 on C
[C E𝄬 \Gam]==
```

11-limit intervals go through neutrals using the rastmic √(243/242) up caret ^ and the down v.
```
# 9:10:11 on C
[C D𝄯 vEd]==
```

## Prime mappings

Instead of "edo" you can use Wart Notation to select a different prime mapping.
```
{A = 440Hz}
# This progression would drift with plain
# {17edo} so we use the 17c val instead.
{17c}
|:@x10
[`A Cv5 E]
[Cv5 E Gv5]
[`B Dv5 Gv5]
[`Av5 Dv5 F#]
{root = Av5} :|
```

Custom prime mappings are supported.
```
# Generator climb in WE tuned tetracot
{map = <1199.559c 1903.939c 2784.414c]}
`A    E     F     |
`B^5  E     D^5   |
C#^25 D^5   F^5   |
D#^125-     E^125 |
E#^5^5^5^5- C^5   |
[E, A]===         ||
```
# Diamond-mos notation

Many equal temperaments lack an interval near a just 3/2, but still contain many useful scales constructed by stacking one generating interval.
```
# Stacking 8\11 produces the "Nerevarine" mode
{11edo}{2 4 5 7 8 10 11}
0 1 2 3 4 5 6 7=

# The same mode of the "Smitonic" scale
MOS{4L 3s}
J K L M N O P j=
```

Moment of symmetry scales consist of large (L) and small (s) steps mixed as evenly as possible. They use nominals from J onwards and J is always aligned with the root frequency.
```
# "Dylathian" mode of "Oneirotonic"
MOS{5L3s}
J K L M N O P Q j=
{root = 333Hz}
J K L M N O P Q j=
```

Modes are selected by specifying an explicit pattern or by using UDP notation.
```
# "Lorkhanic" of "Smitonic"
MOS{LsLsLLs}
J K L M N O P j=

# "Kagrenacan" of "Smitonic"
# Measuring from the root J...
# two scale degrees are bright (i.e. wide),
# while four degrees are dark (i.e. narrow)
MOS{4L 3s 2|4}
J K L M N O P j=
```

## Scale hardness

The ratio between the sizes of L and s steps is called hardness. It defaults to 2:1 i.e. "basic" hardness. You can either provide the scale pattern in terms of small integers or by specifying L:s after the fact.
```
# "Anti-Kadathian" of hard "Checkertonic"
MOS{31131131}
J K L M N O P Q j=

# "Anti-locrian" of soft "Anti-diatonic"
MOS{2L 5s 3:2}
J K L M N O P j=
```

More complex step ratios require commas between the steps.
```
# "Salmon" of ultrahard "Pine"
MOS{43, 43, 10, 43, 43, 43, 43, 43}
J K L M N O P Q j=
```

## Multi-period scales

MOS scales that have multiple identical periods per octave have less modes available.
```
# ssLssL
MOS{2L 4s 0|4(2)}
J K L M N O j=

# sLssLs
MOS{2L 4s 2|2(2)}
J K L M N O j=

# LssLss (period is optional)
MOS{2L 4s 4|0}
J K L M N O j=
```

## Accidentals

Ampersand & (read "am") raises by one chroma (L - s), while at-sign @ (read "at") lowers by one chroma.
```
MOS{2L 5s}
J J& K L M N@ N O P j=
```

## Half-accidentals
```
MOS{2L 5s 3:1}
J Je J& K L M N@ Na N O P j=
```

## Ups and downs
Diamond-mos pitches get their own ups and downs from the underlying equal temperament.
```
# Minihard Trial implying 17edo
# L = 7\17
# s = 3\17
# & = L-s = 4\17
# e = &/2 = 2\17
# ^ = 1\17 (always one step)
# / = 5\17 (always five steps)
MOS{2L 1s 7:3}
J ^J Je ^Je J& /J vK K
```

Hardness declarations are not reduced. 8:4 implies basic hardness but finer octave division.
```
# 12edo Lydian but ups are 1\48
MOS{5L 2s 8:4}
J ^J Je vJ& J&
```

MOS ups and lifts are customizable. Integers are interpreted as steps of the host edo.
```
MOS{7L 1s 43:10 3|4; ^=4; /=12}
[J, vL, /N, O, ^Q, j, k]===
```

## Other equaves
MOS equave is set by enclosing it in angle brackets.
```
# "Cassiopeian" of "Lambda (Bohlen-Pierce)"
MOS{4L5s<3> 5|3}
J K L M N O P Q R j=
```

```
# 9edf is acceptable for Carlos Alpha
# "Dionian" of hard "Saturnian"
MOS{2L3s<3/2> 2|2 3:1}
J K L M N j=
```

## Modulation and key signatures

You can move the same MOS mode to a different key...
```
# "Erev" of "Machinoid"
MOS{5L 1s}
J K L M N O j=

# Same scale but 4\11 higher
# J becomes J& and K becomes K&
MOS{key = L}
L M N O j k l=
```

...or specify a new UDP mode altogether.
```
# "Medicinal" of "Manual"
MOS{4L 1s 3|1}
J K L M N j=

# Switch to "Indical" mode on K
# M becomes M@
MOS{key = K 1|3}
K L M N j k=
```

Custom key signatures are supported. A natural sign restores the unaltered nominal.
```
MOS{5L 7s 15:13 6|5}
MOS{sig = ^^^K ^M& vN@ ^^\P ^^^R vvvS ^^^T vvvU}
J K L M N O P Q R S T U j U_ j=
```

## Large scales
When the system runs out of nominals it starts over but prefixes everything with a J.
```
@8
MOS{14L5s}
J=== K L M N O P Q R S T
U V W X Y Z JJ JK j===
```
