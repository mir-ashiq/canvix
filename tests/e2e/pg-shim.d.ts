// Ambient typing for the `pg` driver inside e2e specs (v0.16 A1).
//
// `pg` is a transitive dependency (@prisma/adapter-pg) with no bundled
// types and no @types/pg in the tree — declaring exactly the surface
// the specs use keeps `npm run typecheck` green without adding a
// dependency for tests only. Playwright resolves the real module from
// node_modules at runtime.
declare module 'pg' {
  export class Client {
    constructor(config: { connectionString?: string })
    connect(): Promise<void>
    end(): Promise<void>
    query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  }
}
