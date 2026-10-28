require('dotenv').config();
const express = require('express');
const cors = require('cors');
const supabase = require('./supabase');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5500,http://localhost:5500')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    // Allow command-line tools and same-origin requests with no Origin header.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '20kb' }));

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const STATUSES = ['available', 'unavailable'];
const text = (v) => typeof v === 'string' ? v.trim() : '';
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const validPhone = (v) => /^[0-9+\-\s()]{7,20}$/.test(v);

function validateDonor(body, partial = false) {
  const errors = [];
  const fields = ['full_name', 'blood_group', 'phone', 'city', 'state', 'email', 'last_donation_date', 'availability', 'notes'];
  const data = {};
  for (const key of fields) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (!partial || body.full_name !== undefined) {
    const v = text(body.full_name);
    if (v.length < 2 || v.length > 80) errors.push('Name must be 2–80 characters.');
    data.full_name = v;
  }
  if (!partial || body.blood_group !== undefined) {
    const v = text(body.blood_group).toUpperCase();
    if (!BLOOD_GROUPS.includes(v)) errors.push('Choose a valid blood group.');
    data.blood_group = v;
  }
  if (!partial || body.phone !== undefined) {
    const v = text(body.phone);
    if (!validPhone(v)) errors.push('Enter a valid phone number (7–20 characters).');
    data.phone = v;
  }
  if (!partial || body.city !== undefined) {
    const v = text(body.city);
    if (v.length < 2 || v.length > 80) errors.push('City must be 2–80 characters.');
    data.city = v;
  }
  if (!partial || body.state !== undefined) {
    const v = text(body.state);
    if (v.length < 2 || v.length > 80) errors.push('State must be 2–80 characters.');
    data.state = v;
  }
  if (body.email !== undefined || !partial) {
    const v = text(body.email).toLowerCase();
    if (v && !validEmail(v)) errors.push('Enter a valid email address.');
    if (v.length > 254) errors.push('Email is too long.');
    data.email = v || null;
  }
  if (body.last_donation_date !== undefined || !partial) {
    const v = text(body.last_donation_date);
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) {
      errors.push('Last donation date must be a valid date in YYYY-MM-DD format.');
    }
    if (v && v > new Date().toISOString().slice(0, 10)) errors.push('Last donation date cannot be in the future.');
    data.last_donation_date = v || null;
  }
  if (body.availability !== undefined || !partial) {
    const v = text(body.availability || 'available').toLowerCase();
    if (!STATUSES.includes(v)) errors.push('Availability must be available or unavailable.');
    data.availability = v;
  }
  if (body.notes !== undefined || !partial) {
    const v = text(body.notes);
    if (v.length > 500) errors.push('Notes must be 500 characters or fewer.');
    data.notes = v || null;
  }
  return { errors, data };
}

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function sendDbError(res, error) {
  console.error('Supabase operation failed:', error.message);
  if (error.code === '23505') return res.status(409).json({ error: 'A donor with these details already exists.' });
  if (error.code === '23503' || error.code === '23514') return res.status(400).json({ error: 'The submitted data does not meet database constraints.' });
  return res.status(500).json({ error: 'Database operation failed. Check the schema and server configuration.' });
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'blood-donor-directory-api' }));

app.get('/api/donors', asyncRoute(async (req, res) => {
  const bloodGroup = text(req.query.bloodGroup).toUpperCase();
  const city = text(req.query.city);
  const availability = text(req.query.availability || 'available').toLowerCase();
  const search = text(req.query.search);
  const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 50));
  if (bloodGroup && !BLOOD_GROUPS.includes(bloodGroup)) return res.status(400).json({ error: 'Invalid blood group filter.' });
  if (availability && !['available', 'unavailable', 'all'].includes(availability)) return res.status(400).json({ error: 'Invalid availability filter.' });
  let query = supabase.from('donors').select('id, full_name, blood_group, phone, city, state, email, last_donation_date, availability, notes, created_at, updated_at', { count: 'exact' });
  if (bloodGroup) query = query.eq('blood_group', bloodGroup);
  if (city) query = query.ilike('city', `%${city.replace(/[%_,]/g, '')}%`);
  if (availability !== 'all') query = query.eq('availability', availability);
  if (search) {
    const safe = search.replace(/[%_,()]/g, '').slice(0, 80);
    if (safe) query = query.or(`full_name.ilike.%${safe}%,city.ilike.%${safe}%,state.ilike.%${safe}%`);
  }
  const from = (page - 1) * limit;
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, from + limit - 1);
  if (error) return sendDbError(res, error);
  res.json({ data, pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) } });
}));

app.get('/api/donors/:id', asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('donors').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return sendDbError(res, error);
  if (!data) return res.status(404).json({ error: 'Donor not found.' });
  res.json({ data });
}));

app.post('/api/donors', asyncRoute(async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Request body must be a JSON object.' });
  const { errors, data } = validateDonor(req.body);
  if (errors.length) return res.status(400).json({ error: 'Please correct the highlighted fields.', details: errors });
  const { data: created, error } = await supabase.from('donors').insert(data).select('*').single();
  if (error) return sendDbError(res, error);
  res.status(201).json({ message: 'Donor registered successfully.', data: created });
}));

app.patch('/api/donors/:id', asyncRoute(async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Request body must be a JSON object.' });
  const allowed = ['full_name', 'blood_group', 'phone', 'city', 'state', 'email', 'last_donation_date', 'availability', 'notes'];
  if (!Object.keys(req.body).some((key) => allowed.includes(key))) return res.status(400).json({ error: 'Provide at least one editable donor field.' });
  const { errors, data } = validateDonor(req.body, true);
  if (errors.length) return res.status(400).json({ error: 'Please correct the submitted fields.', details: errors });
  const { data: updated, error } = await supabase.from('donors').update({ ...data, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').maybeSingle();
  if (error) return sendDbError(res, error);
  if (!updated) return res.status(404).json({ error: 'Donor not found.' });
  res.json({ message: 'Donor updated successfully.', data: updated });
}));

app.delete('/api/donors/:id', asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('donors').delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) return sendDbError(res, error);
  if (!data) return res.status(404).json({ error: 'Donor not found.' });
  res.json({ message: 'Donor deleted successfully.' });
}));

app.use((req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request body.' });
  if (err.message === 'Origin not allowed by CORS') return res.status(403).json({ error: err.message });
  console.error('Unexpected server error:', err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => console.log(`Blood Donor Directory API listening on http://localhost:${PORT}`));
