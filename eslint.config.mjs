import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Enforces the platform's repository-scope rule (plan/PLAN_PLATFORM.md §1):
 * every tenant-owned data access method on a Postgres*Repository/Resolver
 * class must accept `context: TenantContext` as its first parameter, so a
 * caller can never accidentally query without a tenant scope.
 */
const repositoryScopeRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Public methods on Postgres*Repository/*Resolver classes must take `context: TenantContext` as their first parameter.',
    },
    schema: [],
    messages: {
      missingContext:
        'Method "{{name}}" accesses tenant-owned data but does not take `context: TenantContext` as its first parameter. Unscoped repository methods are forbidden (plan/PLAN_PLATFORM.md §1).',
    },
  },
  create(context) {
    return {
      MethodDefinition(node) {
        if (node.kind === 'constructor' || node.kind === 'get' || node.kind === 'set') return;
        if (node.static) return;
        if (node.accessibility === 'private') return;
        if (node.key.type !== 'Identifier') return;

        const firstParam = node.value.params[0];
        const typeAnnotation = firstParam?.typeAnnotation?.typeAnnotation;
        const isTenantContext =
          firstParam?.type === 'Identifier' &&
          typeAnnotation?.type === 'TSTypeReference' &&
          typeAnnotation.typeName?.type === 'Identifier' &&
          typeAnnotation.typeName.name === 'TenantContext';

        if (!isTenantContext) {
          context.report({ node: node.key, messageId: 'missingContext', data: { name: node.key.name } });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript's own strict compiler already catches unused/undefined
      // symbols; re-litigating that in ESLint on a codebase with no prior
      // lint history would surface a wall of unrelated pre-existing findings
      // unrelated to this rule's purpose. Keep the ratchet narrow for now.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['packages/db/src/postgres-*.ts'],
    ignores: ['**/*.test.ts'],
    plugins: {
      'repo-boundaries': { rules: { 'repository-scope': repositoryScopeRule } },
    },
    rules: {
      'repo-boundaries/repository-scope': 'error',
    },
  },
);
