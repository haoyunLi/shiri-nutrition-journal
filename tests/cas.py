# Tests the exact D1-compatible statements in SQLite with synthetic data only.
import sqlite3,pathlib,json
conn=sqlite3.connect(':memory:')
conn.executescript(pathlib.Path('drizzle/0000_quiet_lockjaw.sql').read_text().replace('--> statement-breakpoint',''))
conn.execute('INSERT INTO journals VALUES(?,?,?,?)',('synthetic-owner','{}',0,'test'))
def save(revision,request,payload):
 with conn:
  conn.execute('INSERT OR IGNORE INTO journal_revisions(owner_id,revision,state,created_at) SELECT owner_id,revision,state,? FROM journals WHERE owner_id=? AND revision=?',('test','synthetic-owner',revision))
  cursor=conn.execute('UPDATE journals SET state=?,revision=revision+1,updated_at=? WHERE owner_id=? AND revision=? AND NOT EXISTS (SELECT 1 FROM receipts WHERE owner_id=? AND request_id=?)',(payload,'test','synthetic-owner',revision,'synthetic-owner',request))
  changed=cursor.rowcount
  conn.execute('INSERT INTO receipts(owner_id,request_id,payload_hash,report,created_at) SELECT ?,?,?,?,? WHERE changes()=1',('synthetic-owner',request,'hash','{}','test'))
  return changed
assert save(0,'request-1','{"meals":[]}')==1
assert save(0,'request-2','malicious-old')==0
assert save(1,'request-1','different-payload')==0
assert conn.execute('SELECT revision,state FROM journals').fetchone()==(1,'{"meals":[]}')
assert conn.execute('SELECT count(*) FROM receipts').fetchone()[0]==1
assert conn.execute('SELECT count(*) FROM journal_revisions').fetchone()[0]==2
assert conn.execute('SELECT count(*) FROM journals WHERE owner_id=?',('another-owner',)).fetchone()[0]==0
print('SQLite CAS/replay/owner scoping checks passed; synthetic only.')
