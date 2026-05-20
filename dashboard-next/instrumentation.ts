// Next.js calls register() once on server boot. We dynamically import the
// Node-only init so webpack doesn't try to bundle fs/path for the edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node');
  }
}
