import { describe, expect, it } from "vitest";
import { parse } from "../parser.generated.js";

const score = String.raw`# FJS and prefix modifiers
E^5 Eb_5 P1_5 Cv5
/'C '/C vDb C#

# Context changes
{24edo}
{^ = 1\24}
{/ = 5\24}
{map = <24\24 38\24 56\24 67\24 83\24]}

# Parallel composition; duration checks happen after parsing
C D,
E F G,
A B . ||

# Repeat remains an AST macro
{root = 220Hz}
{${"`"}A = root}
{41edo}
|:(x10)
[${"`"}A, Cv5, E]
[Cv5, E, Gv5]
[${"`"}B, Dv5, Gv5]
[${"`"}Av5, Dv5, F#]
{root = ${"`"}Av5}
:|`;

type SyntaxNode = {
  type: string;
  [property: string]: unknown;
};

describe("Xenpaper surface grammar", () => {
  it("compiles and parses the representative score syntax", () => {
    const program = parse(score);

    expect(program.type).toBe("Program");
    expect(program.source).toBe(score);
    expect((program.comments as SyntaxNode[]).map((comment) => comment.value)).toEqual([
      " FJS and prefix modifiers",
      " Context changes",
      " Parallel composition; duration checks happen after parsing",
      " Repeat remains an AST macro",
    ]);
  });

  it("distinguishes attached FJS inflections and prefix pitch modifiers", () => {
    const program = parse("E^5 Eb_5 P1_5 Cv5 /'C '/C vDb C#");
    const items = (program.body as SyntaxNode[])[0].items as SyntaxNode[];

    expect(items.map((item) => item.type)).toEqual([
      "PitchLiteral",
      "PitchLiteral",
      "IntervalLiteral",
      "PitchLiteral",
      "PitchLiteral",
      "PitchLiteral",
      "PitchLiteral",
      "PitchLiteral",
    ]);
    expect(items.map((item) => item.raw)).toEqual([
      "E^5",
      "Eb_5",
      "P1_5",
      "Cv5",
      "/'C",
      "'/C",
      "vDb",
      "C#",
    ]);
  });

  it("keeps parallel branches and repeats as syntax-tree nodes", () => {
    const program = parse("C D,\nE F G,\nA B . ||\n|:(x10) [C, E, G] :|");
    const body = program.body as SyntaxNode[];

    expect(body.map((item) => item.type)).toEqual(["Parallel", "HardBoundary", "Repeat"]);
    expect((body[0].branches as SyntaxNode[]).map((branch) => branch.type)).toEqual([
      "Sequence",
      "Sequence",
      "Sequence",
    ]);
    expect((body[2].count as SyntaxNode).value).toBe("10");
  });

  it("admits equave shifts with negative degrees", () => {
    const expression = parse('"-2').body[0];

    expect(expression.type).toBe("UnaryExpression");
    expect(expression.operator).toBe('"');
    expect((expression.operand as SyntaxNode).type).toBe("DegreeLiteral");
    expect((expression.operand as SyntaxNode).degree).toBe("-2");
  });

  it("admits equave shifts with ratios", () => {
    const expression = parse('"3/2').body[0];

    expect(expression.type).toBe("UnaryExpression");
    expect(expression.operator).toBe('"');
    expect((expression.operand as SyntaxNode).type).toBe("RatioLiteral");
  });

  it("parses unary plus degrees like unary minus degrees", () => {
    const expression = parse("+5").body[0];

    expect(expression.type).toBe("DegreeLiteral");
    expect(expression.degree).toBe("5");
  });

  it("parses a sequence of degrees", () => {
    const program = parse("0 1 2 -3");
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[];

    expect(items.map((item) => item.type)).toEqual([
      "DegreeLiteral",
      "DegreeLiteral",
      "DegreeLiteral",
      "DegreeLiteral",
    ]);
    expect(items.map((item) => item.degree)).toEqual(["0", "1", "2", "-3"]);
  });

  it("parses a sequence of degrees followed by binary operation of integers", () => {
    const program = parse("0 1 2 - 3");
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[];

    expect(items.map((item) => item.type)).toEqual([
      "DegreeLiteral",
      "DegreeLiteral",
      "BinaryExpression",
    ]);
    expect(items[2].operator).toBe("-");
  });

  it("parses a parallel composition of degrees", () => {
    const program = parse("0, 1, 2, -3");
    const branches = (program.body[0] as SyntaxNode).branches as SyntaxNode[];

    expect(branches.map((branch) => branch.type)).toEqual([
      "DegreeLiteral",
      "DegreeLiteral",
      "DegreeLiteral",
      "DegreeLiteral",
    ]);
    expect(branches.map((branch) => branch.degree)).toEqual(["0", "1", "2", "-3"]);
  });

  it("parses a slotted triplet of degrees", () => {
    const program = parse("[1 -2 3]");
    const expression = (program.body[0] as SyntaxNode).expression as SyntaxNode;
    const items = expression.items as SyntaxNode[];

    expect(expression.type).toBe("Sequence");
    expect(items.map((item) => item.degree)).toEqual(["1", "-2", "3"]);
  });

  it("parses a slotted chord of degrees", () => {
    const program = parse("[1, -2, 3]");
    const expression = (program.body[0] as SyntaxNode).expression as SyntaxNode;
    const branches = expression.branches as SyntaxNode[];

    expect(expression.type).toBe("Parallel");
    expect(branches.map((branch) => branch.degree)).toEqual(["1", "-2", "3"]);
  });
});
