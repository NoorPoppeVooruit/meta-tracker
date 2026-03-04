"""
Meta Analytics Tracker — Railway-ready versie
===============================================
Tokens worden gelezen uit environment variables.
Stel deze in via het Railway dashboard onder "Variables".
"""

import os, sqlite3, requests, logging, time
from datetime import datetime, timedelta
from pathlib import Path
from apscheduler.schedulers.blocking import BlockingScheduler

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()])
log = logging.getLogger(__name__)

BASE_URL   = "https://graph.facebook.com/v19.0"
TRACK_DAYS = 3
MAX_POSTS  = 10

PAGE_A = {
    "label":        "persoon_a",
    "page_id":      os.environ.get("PAGE_A_ID", ""),
    "ig_user_id":   os.environ.get("PAGE_A_IG_ID", ""),
    "access_token": os.environ.get("PAGE_A_TOKEN", ""),
}
PAGE_B = {
    "label":        "persoon_b",
    "page_id":      os.environ.get("PAGE_B_ID", ""),
    "ig_user_id":   os.environ.get("PAGE_B_IG_ID", ""),
    "access_token": os.environ.get("PAGE_B_TOKEN", ""),
}

DATA_DIR = Path(os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "/tmp")) / "meta_data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = str(DATA_DIR / "meta_analytics.db")


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS posts (
            post_id TEXT PRIMARY KEY, page_id TEXT, page_label TEXT NOT NULL,
            platform TEXT NOT NULL DEFAULT 'facebook', message TEXT,
            media_type TEXT, permalink TEXT, created_time TEXT NOT NULL, first_seen TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL,
            page_label TEXT NOT NULL, platform TEXT NOT NULL, measured_at TEXT NOT NULL,
            impressions INTEGER, reach INTEGER, engaged_users INTEGER,
            likes INTEGER, comments INTEGER, shares INTEGER, reactions INTEGER,
            ig_impressions INTEGER, ig_reach INTEGER, ig_saved INTEGER, ig_video_views INTEGER,
            FOREIGN KEY (post_id) REFERENCES posts(post_id)
        );
        CREATE TABLE IF NOT EXISTS follower_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT, page_label TEXT NOT NULL,
            platform TEXT NOT NULL, measured_at TEXT NOT NULL, followers INTEGER, fans INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_snap_post ON snapshots(post_id);
        CREATE INDEX IF NOT EXISTS idx_snap_page ON snapshots(page_label);
    """)
    con.commit(); con.close()
    log.info(f"✅ Database: {DB_PATH}")


def upsert_post(con, **kw):
    con.execute("""INSERT OR IGNORE INTO posts
        (post_id,page_id,page_label,platform,message,media_type,permalink,created_time,first_seen)
        VALUES (:post_id,:page_id,:page_label,:platform,:message,:media_type,:permalink,:created_time,:first_seen)
    """, {**kw, "first_seen": datetime.utcnow().isoformat()}); con.commit()


def insert_snap(con, post_id, page_label, platform, m):
    con.execute("""INSERT INTO snapshots
        (post_id,page_label,platform,measured_at,impressions,reach,engaged_users,
         likes,comments,shares,reactions,ig_impressions,ig_reach,ig_saved,ig_video_views)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (post_id, page_label, platform, datetime.utcnow().isoformat(),
         m.get("impressions"), m.get("reach"), m.get("engaged_users"),
         m.get("likes"), m.get("comments"), m.get("shares"), m.get("reactions"),
         m.get("ig_impressions"), m.get("ig_reach"), m.get("ig_saved"), m.get("ig_video_views")))
    con.commit()


def insert_followers(con, label, platform, followers, fans=None):
    con.execute("INSERT INTO follower_snapshots (page_label,platform,measured_at,followers,fans) VALUES (?,?,?,?,?)",
        (label, platform, datetime.utcnow().isoformat(), followers, fans)); con.commit()


def active_posts(con, label):
    cutoff = (datetime.utcnow() - timedelta(days=TRACK_DAYS)).isoformat()
    return con.execute("SELECT post_id, platform FROM posts WHERE page_label=? AND first_seen>=?",
        (label, cutoff)).fetchall()


def api(endpoint, params):
    try:
        r = requests.get(f"{BASE_URL}/{endpoint}", params=params, timeout=15)
        r.raise_for_status(); return r.json()
    except Exception as e:
        log.error(f"API fout {endpoint}: {e}"); return None


def fb_posts(pid, tok):
    d = api(f"{pid}/posts", {"access_token": tok, "fields": "id,message,created_time,permalink_url", "limit": MAX_POSTS})
    return d.get("data", []) if d else []

def fb_insights(post_id, tok):
    d = api(f"{post_id}/insights", {"access_token": tok,
        "metric": "post_impressions,post_reach,post_engaged_users", "period": "lifetime"})
    out = {}
    if d and "data" in d:
        km = {"post_impressions":"impressions","post_reach":"reach","post_engaged_users":"engaged_users"}
        for item in d["data"]:
            val = (item.get("values") or [{}])[-1].get("value", 0)
            if item["name"] in km: out[km[item["name"]]] = val
    return out

def fb_public(post_id, tok):
    d = api(post_id, {"access_token": tok,
        "fields": "likes.summary(true),comments.summary(true),shares,reactions.summary(true)"})
    if not d: return {}
    return {"likes": d.get("likes",{}).get("summary",{}).get("total_count",0),
            "comments": d.get("comments",{}).get("summary",{}).get("total_count",0),
            "shares": d.get("shares",{}).get("count",0),
            "reactions": d.get("reactions",{}).get("summary",{}).get("total_count",0)}

def fb_followers(pid, tok):
    d = api(pid, {"access_token": tok, "fields": "followers_count,fan_count"})
    return (d.get("followers_count",0), d.get("fan_count",0)) if d else (0,0)

def ig_media(ig_id, tok):
    d = api(f"{ig_id}/media", {"access_token": tok,
        "fields": "id,caption,media_type,permalink,timestamp", "limit": MAX_POSTS})
    return d.get("data", []) if d else []

def ig_insights(mid, tok):
    out = {}
    d = api(f"{mid}/insights", {"access_token": tok, "metric": "impressions,reach,saved,likes,comments"})
    if d and "data" in d:
        km = {"impressions":"ig_impressions","reach":"ig_reach","saved":"ig_saved","likes":"likes","comments":"comments"}
        for item in d["data"]:
            val = item.get("values",[{}])[-1].get("value") if item.get("values") else item.get("value",0)
            if item["name"] in km: out[km[item["name"]]] = val
    vd = api(f"{mid}/insights", {"access_token": tok, "metric": "video_views"})
    if vd and "data" in vd:
        for item in vd["data"]:
            if item["name"] == "video_views": out["ig_video_views"] = item.get("value",0)
    return out

def ig_followers(ig_id, tok):
    d = api(ig_id, {"access_token": tok, "fields": "followers_count"})
    return d.get("followers_count", 0) if d else 0


def collect_page(con, cfg):
    label, token = cfg["label"], cfg["access_token"]
    if not token:
        log.warning(f"⚠️  Geen token voor {label}"); return
    log.info(f"▶ {label}")
    cur_active = active_posts(con, label)

    if cfg.get("page_id"):
        pid = cfg["page_id"]
        flw, fans = fb_followers(pid, token)
        insert_followers(con, label, "facebook", flw, fans)
        for p in fb_posts(pid, token):
            upsert_post(con, post_id=p["id"], page_id=pid, page_label=label, platform="facebook",
                        message=p.get("message","")[:500], media_type=None,
                        permalink=p.get("permalink_url"), created_time=p.get("created_time",""))
        for post_id, plat in cur_active:
            if plat != "facebook": continue
            m = {**fb_insights(post_id, token), **fb_public(post_id, token)}
            insert_snap(con, post_id, label, "facebook", m)
            log.info(f"  FB {post_id} reach={m.get('reach')} likes={m.get('likes')}")
            time.sleep(0.4)

    if cfg.get("ig_user_id"):
        ig_id = cfg["ig_user_id"]
        flw = ig_followers(ig_id, token)
        insert_followers(con, label, "instagram", flw)
        for media in ig_media(ig_id, token):
            upsert_post(con, post_id=media["id"], page_id=ig_id, page_label=label, platform="instagram",
                        message=media.get("caption","")[:500], media_type=media.get("media_type"),
                        permalink=media.get("permalink"), created_time=media.get("timestamp",""))
        for post_id, plat in cur_active:
            if plat != "instagram": continue
            m = ig_insights(post_id, token)
            insert_snap(con, post_id, label, "instagram", m)
            log.info(f"  IG {post_id} ig_reach={m.get('ig_reach')} likes={m.get('likes')}")
            time.sleep(0.4)
    log.info(f"✅ {label} klaar")


def collect_all():
    log.info("═══ Meting gestart ═══")
    con = sqlite3.connect(DB_PATH)
    try:
        for cfg in [PAGE_A, PAGE_B]:
            try: collect_page(con, cfg)
            except Exception as e: log.error(f"Fout {cfg['label']}: {e}", exc_info=True)
    finally: con.close()
    log.info("═══ Klaar ═══\n")


if __name__ == "__main__":
    log.info("🚀 Meta Tracker — Railway")
    log.info(f"   PAGE_A_ID  = {PAGE_A['page_id']  or '⚠️ NIET INGESTELD'}")
    log.info(f"   PAGE_B_ID  = {PAGE_B['page_id']  or '⚠️ NIET INGESTELD'}")
    log.info(f"   DB         = {DB_PATH}")
    init_db()
    collect_all()
    scheduler = BlockingScheduler(timezone="Europe/Amsterdam")
    scheduler.add_job(collect_all, "interval", hours=1, id="collect")
    log.info("⏰ Elk uur een meting")
    try: scheduler.start()
    except (KeyboardInterrupt, SystemExit): log.info("Gestopt.")
