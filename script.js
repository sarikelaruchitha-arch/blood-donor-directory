/* LifeLink frontend: plain JavaScript + Fetch API. */
(() => {
  'use strict';
  const API_BASE = (window.LIFELINK_API_BASE || 'http://localhost:3000/api').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const state = { page: 1, totalPages: 1, donors: [], pendingDeleteId: null };
  const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

  $('currentYear').textContent = new Date().getFullYear();
  $('lastDonationDate').max = new Date().toISOString().slice(0, 10);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    $('toastRegion').appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }
  function setFormMessage(message, type) {
    const el = $('formMessage');
    el.textContent = message;
    el.className = `form-message show ${type}`;
  }
  function clearFormMessage() {
    $('formMessage').textContent = '';
    $('formMessage').className = 'form-message';
  }
  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
      });
    } catch {
      throw new Error('Could not reach the API. Make sure the backend is running and the API URL is correct.');
    }
    let payload;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      const details = Array.isArray(payload.details) ? ` ${payload.details.join(' ')}` : '';
      throw new Error((payload.error || `Request failed (${response.status}).`) + details);
    }
    return payload;
  }

  function currentFilters() {
    return {
      bloodGroup: $('filterBloodGroup').value,
      city: $('filterCity').value.trim(),
      search: $('filterSearch').value.trim()
    };
  }
  async function loadDonors() {
    const grid = $('donorGrid');
    grid.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Loading donor directory…</p></div>';
    $('pagination').hidden = true;
    const params = new URLSearchParams({ page: String(state.page), limit: '9', availability: 'all' });
    const filters = currentFilters();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const result = await api(`/donors?${params.toString()}`);
      state.donors = result.data || [];
      state.totalPages = result.pagination?.totalPages || 1;
      $('resultCount').textContent = result.pagination?.total ?? state.donors.length;
      $('resultsSummary').textContent = state.donors.length ? `Showing ${state.donors.length} of ${result.pagination.total} listing(s).` : 'No donors match those filters.';
      renderDonors(state.donors);
      renderPagination(result.pagination);
    } catch (error) {
      $('resultCount').textContent = '—';
      $('resultsSummary').textContent = 'We could not load the directory.';
      grid.innerHTML = `<div class="error-state"><div class="empty-icon">!</div><strong>Could not load donors</strong><p>${escapeHtml(error.message)}</p><button class="button button-outline" id="retryLoad" type="button">Try again</button></div>`;
      $('retryLoad').addEventListener('click', loadDonors);
      showToast(error.message, 'error');
    }
  }

  function renderDonors(donors) {
    const grid = $('donorGrid');
    if (!donors.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">♡</div><strong>No donors found just yet</strong><p>Try a different blood group or location, or become the first donor to register.</p><a class="button button-primary" href="#register">Become a donor →</a></div>';
      return;
    }
    grid.innerHTML = donors.map((donor) => {
      const name = escapeHtml(donor.full_name);
      const initials = escapeHtml(donor.full_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase());
      const location = `${escapeHtml(donor.city)}, ${escapeHtml(donor.state)}`;
      const phone = escapeHtml(donor.phone);
      const available = donor.availability === 'available';
      const notes = donor.notes ? `<p class="donor-notes">${escapeHtml(donor.notes)}</p>` : '';
      const email = donor.email ? `<div><span class="meta-icon">✉</span><span>${escapeHtml(donor.email)}</span></div>` : '';
      const lastDonation = donor.last_donation_date ? `<div><span class="meta-icon">◷</span><span>Last donation: ${escapeHtml(donor.last_donation_date)}</span></div>` : '';
      const contact = available ? `<a class="button button-primary" href="tel:${phone.replace(/[^\d+]/g, '')}">Call donor ↗</a>` : '<button class="button button-outline" type="button" disabled>Unavailable</button>';
      return `<article class="donor-card">
        <div class="donor-card-top"><div class="donor-person"><div class="donor-avatar">${initials}</div><div><div class="donor-name">${name}</div><div class="donor-location">⌖ ${location}</div></div></div><span class="blood-badge">${escapeHtml(donor.blood_group)}</span></div>
        <span class="availability ${available ? '' : 'unavailable'}">${available ? 'Available to contact' : 'Not available currently'}</span>
        <div class="donor-meta"><div><span class="meta-icon">☎</span><span>${phone}</span></div>${email}${lastDonation}</div>${notes}
        <div class="donor-actions">${contact}<button class="button button-outline edit-donor" type="button" data-id="${escapeHtml(donor.id)}">Edit</button><button class="button button-danger delete-donor" type="button" data-id="${escapeHtml(donor.id)}" aria-label="Delete ${name}">Delete</button></div>
      </article>`;
    }).join('');
    grid.querySelectorAll('.edit-donor').forEach((button) => button.addEventListener('click', () => editDonor(button.dataset.id)));
    grid.querySelectorAll('.delete-donor').forEach((button) => button.addEventListener('click', () => askDelete(button.dataset.id)));
  }

  function renderPagination(pagination) {
    const el = $('pagination');
    if (!pagination || pagination.totalPages <= 1) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<button type="button" id="prevPage" ${pagination.page <= 1 ? 'disabled' : ''}>← Previous</button><span>Page ${pagination.page} of ${pagination.totalPages}</span><button type="button" id="nextPage" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>Next →</button>`;
    $('prevPage').addEventListener('click', () => { state.page--; loadDonors(); });
    $('nextPage').addEventListener('click', () => { state.page++; loadDonors(); });
  }

  $('searchForm').addEventListener('submit', (event) => { event.preventDefault(); state.page = 1; loadDonors(); });
  $('clearFilters').addEventListener('click', () => {
    $('filterBloodGroup').value = ''; $('filterCity').value = ''; $('filterSearch').value = '';
    state.page = 1; loadDonors();
  });
  $('menuToggle').addEventListener('click', () => {
    const open = $('menuToggle').getAttribute('aria-expanded') !== 'true';
    $('menuToggle').setAttribute('aria-expanded', String(open));
    $('menuToggle').textContent = open ? '×' : '☰';
    document.querySelector('.nav-links').classList.toggle('open', open);
  });
  document.querySelectorAll('.nav-links a').forEach((link) => link.addEventListener('click', () => {
    document.querySelector('.nav-links').classList.remove('open');
    $('menuToggle').setAttribute('aria-expanded', 'false'); $('menuToggle').textContent = '☰';
  }));

  function formPayload() {
    return {
      full_name: $('fullName').value.trim(),
      blood_group: $('bloodGroup').value,
      phone: $('phone').value.trim(),
      email: $('email').value.trim(),
      city: $('city').value.trim(),
      state: $('state').value.trim(),
      last_donation_date: $('lastDonationDate').value,
      availability: $('availability').value,
      notes: $('notes').value.trim()
    };
  }
  function validateClient(payload) {
    if (payload.full_name.length < 2 || payload.full_name.length > 80) return 'Name must be 2–80 characters.';
    if (!bloodGroups.includes(payload.blood_group)) return 'Please choose a valid blood group.';
    if (!/^[0-9+\-\s()]{7,20}$/.test(payload.phone)) return 'Enter a valid phone number.';
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return 'Enter a valid email address.';
    if (payload.city.length < 2 || payload.city.length > 80 || payload.state.length < 2 || payload.state.length > 80) return 'City and state must each be 2–80 characters.';
    if (payload.last_donation_date && payload.last_donation_date > new Date().toISOString().slice(0, 10)) return 'Last donation date cannot be in the future.';
    if (payload.notes.length > 500) return 'Notes must be 500 characters or fewer.';
    if (!$('consent').checked) return 'Please confirm that you consent to sharing these details.';
    return '';
  }
  function resetForm() {
    $('donorForm').reset(); $('donorId').value = ''; $('availability').value = 'available';
    $('lastDonationDate').max = new Date().toISOString().slice(0, 10);
    $('submitDonor').innerHTML = 'Join the donor directory <span>→</span>';
    $('cancelEdit').hidden = true; clearFormMessage();
  }
  $('donorForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearFormMessage();
    const payload = formPayload();
    const validation = validateClient(payload);
    if (validation) { setFormMessage(validation, 'error'); return; }
    const id = $('donorId').value;
    const button = $('submitDonor');
    button.disabled = true; button.textContent = id ? 'Saving changes…' : 'Registering…';
    try {
      const result = await api(id ? `/donors/${encodeURIComponent(id)}` : '/donors', {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload)
      });
      setFormMessage(result.message || 'Saved successfully.', 'success');
      showToast(result.message || 'Saved successfully.', 'success');
      resetForm(); state.page = 1; await loadDonors();
      $('find').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setFormMessage(error.message, 'error');
    } finally {
      button.disabled = false;
      if ($('donorId').value) button.textContent = 'Save donor changes';
      else button.innerHTML = 'Join the donor directory <span>→</span>';
    }
  });
  $('cancelEdit').addEventListener('click', resetForm);

  async function editDonor(id) {
    try {
      const result = await api(`/donors/${encodeURIComponent(id)}`);
      const donor = result.data;
      $('donorId').value = donor.id;
      $('fullName').value = donor.full_name || '';
      $('bloodGroup').value = donor.blood_group || '';
      $('phone').value = donor.phone || '';
      $('email').value = donor.email || '';
      $('city').value = donor.city || '';
      $('state').value = donor.state || '';
      $('lastDonationDate').value = donor.last_donation_date || '';
      $('availability').value = donor.availability || 'available';
      $('notes').value = donor.notes || '';
      $('consent').checked = true;
      $('submitDonor').textContent = 'Save donor changes';
      $('cancelEdit').hidden = false;
      setFormMessage('Editing this listing. Please confirm consent before saving.', 'success');
      $('register').scrollIntoView({ behavior: 'smooth' });
      $('fullName').focus({ preventScroll: true });
    } catch (error) { showToast(error.message, 'error'); }
  }

  function askDelete(id) {
    state.pendingDeleteId = id;
    const dialog = $('deleteDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else if (window.confirm('Remove this donor listing permanently?')) deleteDonor(id);
  }
  $('confirmDelete').addEventListener('click', async (event) => {
    event.preventDefault();
    const id = state.pendingDeleteId;
    if (!id) { $('deleteDialog').close(); return; }
    const button = $('confirmDelete'); button.disabled = true; button.textContent = 'Deleting…';
    try {
      const result = await api(`/donors/${encodeURIComponent(id)}`, { method: 'DELETE' });
      $('deleteDialog').close(); showToast(result.message || 'Donor removed.', 'success');
      if (state.donors.length === 1 && state.page > 1) state.page--;
      await loadDonors();
      if ($('donorId').value === id) resetForm();
    } catch (error) {
      $('deleteDialog').close(); showToast(error.message, 'error');
    } finally { state.pendingDeleteId = null; button.disabled = false; button.textContent = 'Delete listing'; }
  });
  async function deleteDonor(id) {
    try { await api(`/donors/${encodeURIComponent(id)}`, { method: 'DELETE' }); showToast('Donor removed.', 'success'); await loadDonors(); }
    catch (error) { showToast(error.message, 'error'); }
  }

  // Check the API and load actual Supabase-backed records; no mock data is used.
  api('/health').then(() => loadDonors()).catch((error) => {
    $('donorGrid').innerHTML = `<div class="error-state"><div class="empty-icon">!</div><strong>API connection unavailable</strong><p>${escapeHtml(error.message)}</p><p>Start the backend and check your Supabase configuration.</p><button class="button button-outline" id="retryLoad" type="button">Try again</button></div>`;
    $('resultsSummary').textContent = 'The API could not be reached.';
    $('retryLoad').addEventListener('click', () => api('/health').then(loadDonors).catch((e) => showToast(e.message, 'error')));
  });
})();
