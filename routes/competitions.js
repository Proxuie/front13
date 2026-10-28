const express = require('express');
const { db } = require('../db');
const auth = require('../auth/checkAuth');
const { requireRole, badRequest, notFound, validationError } = require('../auth/permissions');
const { checkCompetition, text } = require('../validation');

const router = express.Router();

router.get('/', (req, res) => {
  const { discipline, ageGroup, status } = req.query;
  let sql = `SELECT c.*, d.name AS discipline_name, ag.name AS age_group_name
    FROM competitions c
    JOIN disciplines d ON d.id = c.discipline_id
    JOIN age_groups ag ON ag.id = c.age_group_id WHERE 1=1`;
  const params = [];
  if (discipline) { sql += ' AND c.discipline_id = ?'; params.push(discipline); }
  if (ageGroup) { sql += ' AND c.age_group_id = ?'; params.push(ageGroup); }
  if (status) { sql += ' AND c.status = ?'; params.push(status); }
  sql += ' ORDER BY c.date_start DESC';
  res.json(db.prepare(sql).all(...params).map(rowToCompetition));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT c.*, d.name AS discipline_name, ag.name AS age_group_name
    FROM competitions c
    JOIN disciplines d ON d.id = c.discipline_id
    JOIN age_groups ag ON ag.id = c.age_group_id WHERE c.id = ?`).get(req.params.id);
  if (!row) throw notFound('соревнование не найдено');
  res.json(rowToCompetition(row));
});

router.post('/', auth, (req, res) => {
  requireRole(req, ['federation']);
  const body = req.body || {};
  const fields = checkCompetition(body);
  if (Object.keys(fields).length) throw validationError(fields);

  const discipline = db.prepare('SELECT id FROM disciplines WHERE id = ?').get(Number(body.disciplineId));
  if (!discipline) throw validationError({ disciplineId: 'Дисциплина не найдена' });
  const ageGroup = db.prepare('SELECT id FROM age_groups WHERE id = ?').get(Number(body.ageGroupId));
  if (!ageGroup) throw validationError({ ageGroupId: 'Возрастная группа не найдена' });

  const info = db.prepare(`INSERT INTO competitions
    (name, discipline_id, age_group_id, type, level, format, status,
     date_start, date_end, place, calendar_plan, calendar_number, applications_deadline, regulation_url)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      text(body.name),
      Number(body.disciplineId),
      Number(body.ageGroupId),
      text(body.type),
      text(body.level),
      text(body.format),
      text(body.dateStart),
      text(body.dateEnd),
      text(body.place) || null,
      text(body.calendarPlan) || null,
      text(body.calendarNumber) || null,
      text(body.applicationsDeadline) || null,
      text(body.regulationUrl) || null
    );

  audit(req.user.id, 'create', 'competition', info.lastInsertRowid);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.post('/:id/publish', auth, (req, res) => {
  requireRole(req, ['federation']);
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(req.params.id);
  if (!comp) throw notFound('соревнование не найдено');
  if (comp.status !== 'draft') throw badRequest('соревнование уже опубликовано');

  db.prepare("UPDATE competitions SET status = 'applications_open' WHERE id = ?").run(req.params.id);
  audit(req.user.id, 'publish', 'competition', comp.id);
  res.json({ ok: true });
});

router.post('/:id/close-applications', auth, (req, res) => {
  requireRole(req, ['federation']);
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(req.params.id);
  if (!comp) throw notFound('соревнование не найдено');
  if (comp.status !== 'applications_open') throw badRequest('приём заявок уже закрыт');

  db.prepare("UPDATE competitions SET status = 'closed' WHERE id = ?").run(req.params.id);
  audit(req.user.id, 'close_applications', 'competition', comp.id);
  res.json({ ok: true });
});

function rowToCompetition(r) {
  return {
    id: r.id, name: r.name,
    discipline: { id: r.discipline_id, name: r.discipline_name },
    ageGroup: { id: r.age_group_id, name: r.age_group_name },
    type: r.type, level: r.level, format: r.format, status: r.status,
    dateStart: r.date_start, dateEnd: r.date_end, place: r.place,
    calendarPlan: r.calendar_plan, calendarNumber: r.calendar_number,
    applicationsDeadline: r.applications_deadline,
    regulationPath: r.regulation_path,
    regulationUrl: r.regulation_url,
  };
}

function audit(userId, action, entity, entityId) {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, ?, ?, ?)')
    .run(userId, action, entity, entityId);
}

module.exports = router;
