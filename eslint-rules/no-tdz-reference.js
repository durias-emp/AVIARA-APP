// Reading a const before the line that declares it, inside one function body.
//
// This rule exists because the same mistake blanked the home screen three
// times in one afternoon. It looks harmless:
//
//   useEffect(() => { ... }, [routeLine, restY])   // <- restY read here
//   ...180 lines...
//   const restY = dragY != null ? dragY : snapY    // <- declared here
//
// A dependency array is an ordinary array literal, built while the component
// renders, so it reads `restY` on the way past. `const` bindings are in the
// temporal dead zone until their own line runs, so that read throws a
// ReferenceError, React unmounts the tree, and the whole screen goes white.
// `npm run build` never catches it: the code is perfectly valid, it just
// cannot run. Only loading the page finds it, which is why it kept landing.
//
// The narrow part is deciding which reads are actually fatal, because most
// use-before-define in a React component is fine and the codebase is full of
// it:
//
//   <button onClick={() => setOpenField(null)} />   // fine
//   const [openField, setOpenField] = useState()
//
// That one is safe because the arrow does not run during render. By the time
// a finger lands on the button, the declaration has long since executed.
//
// So the test is not "is it declared later", it is "is it declared later AND
// read on the same synchronous pass". That distinction falls straight out of
// scope analysis: a reference inside a nested function belongs to that
// function's scope, while a reference in a dependency array, a prop, or a
// plain const initialiser belongs to the component's. Comparing the two
// variable scopes separates the crash from the idiom without a list of hook
// names to keep up to date, and it catches the non-hook case (a body-level
// const reading a state variable declared below it) that started the run.
//
// Scope: `const`, `let` and `class`, the three that have a dead zone. `var`
// and function declarations hoist, so reading them early is a different bug
// with a different symptom, and this rule stays quiet about them.

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow reading a const, let or class on the same synchronous pass that runs before its declaration, which throws at render and blanks the screen',
    },
    schema: [],
    messages: {
      tdz:
        "'{{name}}' is declared further down this function, and this line runs before it. " +
        'At runtime this throws and the screen goes blank. Move the declaration above this line.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    function check(scope) {
      for (const ref of scope.references) {
        const variable = ref.resolved
        if (!variable || variable.defs.length === 0) continue

        const def = variable.defs[0]

        // Only the declarations that have a dead zone.
        if (def.type === 'Variable') {
          if (def.parent.kind === 'var') continue
        } else if (def.type !== 'ClassName') {
          continue
        }

        // The whole rule, in one line: same function body means the read and
        // the declaration are on one synchronous run, so order decides
        // whether it works. Different bodies means the inner one runs later,
        // when the binding is already there.
        if (ref.from.variableScope !== variable.scope.variableScope) continue

        // Textually later. Ranges are reliable here because both nodes are in
        // the same file and the same scope.
        if (ref.identifier.range[0] >= def.name.range[0]) continue

        context.report({
          node: ref.identifier,
          messageId: 'tdz',
          data: { name: variable.name },
        })
      }

      for (const child of scope.childScopes) check(child)
    }

    return {
      Program(node) {
        check(sourceCode.getScope(node))
      },
    }
  },
}
