-- 曲名+アーティスト名 → YouTube動画 の対応表。
-- search.list は1回100ユニット（1日1万＝約100回）と細いので、一度引いた曲は使い回す。
CREATE TABLE IF NOT EXISTS tracks (
  query_key TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
