use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCommand {
    pub command_id: String,
    pub idempotency_key: String,
    pub command_type: String,
    pub correlation_id: String,
    pub payload: String,
    pub status: String,
    pub attempt_count: u32,
    pub next_attempt_at: String,
    pub deadline_at: String,
    pub last_error: Option<String>,
    pub pending_result: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct LocalQueue {
    conn: Connection,
}

impl LocalQueue {
    pub fn open(db_path: &str) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        let queue = Self { conn };
        queue.ensure_schema()?;
        Ok(queue)
    }

    pub fn open_in_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        let queue = Self { conn };
        queue.ensure_schema()?;
        Ok(queue)
    }

    fn ensure_schema(&self) -> SqlResult<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS local_commands (
                command_id      TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                command_type    TEXT NOT NULL,
                correlation_id  TEXT NOT NULL DEFAULT '',
                payload         TEXT NOT NULL DEFAULT '{}',
                status          TEXT NOT NULL DEFAULT 'queued',
                attempt_count   INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT NOT NULL DEFAULT '',
                deadline_at     TEXT NOT NULL,
                last_error      TEXT,
                pending_result  TEXT,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );",
        )?;
        self.ensure_column(
            "next_attempt_at",
            "ALTER TABLE local_commands ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT ''",
        )?;
        self.ensure_column(
            "pending_result",
            "ALTER TABLE local_commands ADD COLUMN pending_result TEXT",
        )?;
        self.ensure_column(
            "correlation_id",
            "ALTER TABLE local_commands ADD COLUMN correlation_id TEXT NOT NULL DEFAULT ''",
        )?;
        Ok(())
    }

    fn ensure_column(&self, column_name: &str, alter_sql: &str) -> SqlResult<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(local_commands)")?;
        let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;

        for column in columns {
            if column? == column_name {
                return Ok(());
            }
        }

        self.conn.execute_batch(alter_sql)
    }

    pub fn upsert(&self, cmd: &LocalCommand) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO local_commands
                (command_id, idempotency_key, command_type, correlation_id, payload, status,
                 attempt_count, next_attempt_at, deadline_at, last_error, pending_result,
                 created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
             ON CONFLICT(command_id) DO UPDATE SET
                status        = excluded.status,
                attempt_count = excluded.attempt_count,
                next_attempt_at = excluded.next_attempt_at,
                last_error    = excluded.last_error,
                pending_result = excluded.pending_result,
                updated_at    = excluded.updated_at",
            params![
                cmd.command_id,
                cmd.idempotency_key,
                cmd.command_type,
                cmd.correlation_id,
                cmd.payload,
                cmd.status,
                cmd.attempt_count,
                cmd.next_attempt_at,
                cmd.deadline_at,
                cmd.last_error,
                cmd.pending_result,
                cmd.created_at,
                cmd.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_pending(&self) -> SqlResult<Vec<LocalCommand>> {
        let mut stmt = self.conn.prepare(
            "SELECT command_id, idempotency_key, command_type, correlation_id, payload, status,
                    attempt_count, next_attempt_at, deadline_at, last_error, pending_result,
                    created_at, updated_at
             FROM local_commands
             WHERE status IN ('queued', 'delivered') OR pending_result IS NOT NULL
             ORDER BY created_at ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(LocalCommand {
                command_id: row.get(0)?,
                idempotency_key: row.get(1)?,
                command_type: row.get(2)?,
                correlation_id: row.get(3)?,
                payload: row.get(4)?,
                status: row.get(5)?,
                attempt_count: row.get(6)?,
                next_attempt_at: row.get(7)?,
                deadline_at: row.get(8)?,
                last_error: row.get(9)?,
                pending_result: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?;

        rows.collect()
    }

    pub fn store_pending_result(
        &self,
        command_id: &str,
        status: &str,
        pending_result: &str,
        updated_at: &str,
    ) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE local_commands
             SET status = ?2, pending_result = ?3, last_error = NULL, updated_at = ?4
             WHERE command_id = ?1",
            params![command_id, status, pending_result, updated_at],
        )?;
        Ok(())
    }

    pub fn mark_submission_failed(
        &self,
        command_id: &str,
        error: &str,
        next_attempt_at: &str,
        updated_at: &str,
    ) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE local_commands
             SET last_error = ?2, next_attempt_at = ?3, updated_at = ?4,
                 attempt_count = attempt_count + 1
             WHERE command_id = ?1",
            params![command_id, error, next_attempt_at, updated_at],
        )?;
        Ok(())
    }

    pub fn mark_result_submitted(
        &self,
        command_id: &str,
        final_status: &str,
        updated_at: &str,
    ) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE local_commands
             SET status = ?2, pending_result = NULL, last_error = NULL, updated_at = ?3
             WHERE command_id = ?1",
            params![command_id, final_status, updated_at],
        )?;
        Ok(())
    }

    pub fn pending_count(&self) -> u32 {
        match self.conn.query_row(
            "SELECT COUNT(*) FROM local_commands
                 WHERE status IN ('queued', 'delivered') OR pending_result IS NOT NULL",
            [],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(count) => count as u32,
            Err(e) => {
                warn!(error = %e, "Failed to count pending local commands");
                0
            }
        }
    }

    pub fn exists(&self, idempotency_key: &str) -> bool {
        match self.conn.query_row(
            "SELECT 1 FROM local_commands WHERE idempotency_key = ?1",
            params![idempotency_key],
            |_| Ok(true),
        ) {
            Ok(exists) => exists,
            Err(e) => {
                warn!(error = %e, "Failed to check local command existence");
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_command(command_id: &str, idempotency_key: &str) -> LocalCommand {
        LocalCommand {
            command_id: command_id.to_string(),
            idempotency_key: idempotency_key.to_string(),
            command_type: "CreateDraftIn1C".to_string(),
            correlation_id: "corr-1".to_string(),
            payload: "{}".to_string(),
            status: "delivered".to_string(),
            attempt_count: 0,
            next_attempt_at: "1000".to_string(),
            deadline_at: "9999".to_string(),
            last_error: None,
            pending_result: None,
            created_at: "1000".to_string(),
            updated_at: "1000".to_string(),
        }
    }

    #[test]
    fn stores_pending_results_until_backend_submission_succeeds() {
        let queue = LocalQueue::open_in_memory().expect("queue opens");
        let command = local_command("command-1", "idem-1");

        queue.upsert(&command).expect("insert command");
        queue
            .store_pending_result(
                "command-1",
                "succeeded",
                "{\"status\":\"succeeded\"}",
                "1001",
            )
            .expect("store pending result");

        let pending = queue.list_pending().expect("list pending");

        assert_eq!(pending.len(), 1);
        assert_eq!(
            pending[0].pending_result.as_deref(),
            Some("{\"status\":\"succeeded\"}")
        );
        assert_eq!(queue.pending_count(), 1);

        queue
            .mark_result_submitted("command-1", "succeeded", "1002")
            .expect("mark submitted");

        assert!(queue.list_pending().expect("list pending").is_empty());
        assert_eq!(queue.pending_count(), 0);
    }

    #[test]
    fn deduplicates_by_idempotency_key() {
        let queue = LocalQueue::open_in_memory().expect("queue opens");

        queue
            .upsert(&local_command("command-1", "idem-1"))
            .expect("insert command");

        assert!(queue.exists("idem-1"));
        assert!(!queue.exists("idem-2"));
    }
}
