import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = new SQLDatabase("application", {
  migrations: "./migrations",
});

export type Transaction = Awaited<ReturnType<typeof db.begin>>;

// PostgreSQL rejects several statements in one parameterized query, so multi-step writes use a transaction.
export async function inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.begin();
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // Keep the original error when the transaction is already closed.
    }
    throw error;
  }
}
