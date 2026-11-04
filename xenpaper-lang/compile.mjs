import { readFileSync, writeFileSync } from 'node:fs'
import peggy from 'peggy'

// Reuse expression precedence with horizontal whitespace in a let initializer.
// Explicit nested scopes return to the ordinary, newline-insensitive grammar.
const initializerGrammar = {
  use(config) {
    config.passes.prepare.unshift((ast) => {
      const rules = new Map(ast.rules.map((rule) => [rule.name, rule]))
      const scopes = new Set([
        'ParenthesizedExpression',
        'NormalizedGroup',
        'CallArguments',
        'DirectiveArguments',
        'GlissDirectiveArguments',
        'ChordGroupedEnumerand',
        'MonzoLiteral',
        'GrooveDirectiveBody',
        'DroneDirectiveBody',
        'PitchContextChange',
        'MosDeclaration',
        'FunctionBody',
        'RepeatExpression',
        'LambdaExpression',
        'VariableDeclaration',
      ])
      const replacements = new Map([
        ['Spacing', 'InlineSpacing'],
        ['RequiredSpacing', 'RequiredInlineSpacing'],
      ])
      const references = (value, visit) => {
        if (!value || typeof value !== 'object') return
        if (value.type === 'rule_ref') visit(value)
        else
          for (const [key, child] of Object.entries(value)) {
            if (key === 'location') continue
            if (Array.isArray(child)) child.forEach((item) => references(item, visit))
            else references(child, visit)
          }
      }
      // Only duplicate rules whose whitespace behavior changes, through a fixed
      // point so recursive references do not require mutable parser state.
      let changed = true
      while (changed) {
        changed = false
        for (const [name, rule] of rules) {
          if (
            scopes.has(name) ||
            replacements.has(name) ||
            name.startsWith('Initializer') ||
            name.includes('InlineSpacing')
          )
            continue
          let sensitive = false
          references(rule.expression, (ref) => {
            sensitive ||= replacements.has(ref.name)
          })
          if (sensitive) {
            replacements.set(name, `LineBound${name}`)
            changed = true
          }
        }
      }
      for (const [name, replacement] of replacements) {
        if (name === 'Spacing' || name === 'RequiredSpacing') continue
        const rule = structuredClone(rules.get(name))
        rule.name = replacement
        references(rule.expression, (ref) => {
          ref.name = replacements.get(ref.name) ?? ref.name
        })
        ast.rules.push(rule)
      }
    })
  },
}

writeFileSync(
  new URL('./parser.generated.js', import.meta.url),
  peggy.generate(readFileSync(new URL('./xenpaper.peggy', import.meta.url), 'utf8'), {
    output: 'source',
    format: 'es',
    plugins: [initializerGrammar],
  }),
)
