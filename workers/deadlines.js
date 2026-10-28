const cron = require('node-cron');
const { db } = require('../db');

cron.schedule('0 9 * * *', () => {
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const iso = soon.toISOString().slice(0, 10);

  const expiringRanks = db.prepare("SELECT id, fio, rank_until FROM users WHERE rank_until <= ? AND rank_until >= date('now')").all(iso);
  const expiringCats = db.prepare("SELECT id, fio, category_until FROM users WHERE category_until <= ? AND category_until >= date('now')").all(iso);

  if (expiringRanks.length || expiringCats.length) {
    console.log(`[cron] истекают разряды: ${expiringRanks.length}, категории: ${expiringCats.length}`);
  }
});

module.exports = {};