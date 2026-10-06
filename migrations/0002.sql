CREATE TABLE commands (
 team TEXT NOT NULL, request_id TEXT NOT NULL, channel TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('processing','done')), received_at INTEGER NOT NULL,
 result TEXT, PRIMARY KEY(team,request_id)
);
CREATE INDEX command_retention ON commands(received_at);
