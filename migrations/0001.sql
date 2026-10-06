CREATE TABLE aliases (
 team TEXT NOT NULL, channel TEXT NOT NULL, name TEXT NOT NULL,
 members TEXT NOT NULL CHECK(json_valid(members)), creator TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(team,channel,name)
);
CREATE TABLE audit (
 id INTEGER PRIMARY KEY, team TEXT NOT NULL, channel TEXT NOT NULL, name TEXT NOT NULL,
 actor TEXT NOT NULL, action TEXT NOT NULL, happened_at INTEGER NOT NULL
);
CREATE TABLE events (
 team TEXT NOT NULL, event_id TEXT NOT NULL, channel TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('processing','done','failed')), received_at INTEGER NOT NULL,
 error TEXT, PRIMARY KEY(team,event_id)
);
CREATE INDEX event_retention ON events(received_at);
