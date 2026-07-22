const DB_NAME = 'rolling-budget';
const DB_VERSION = 1;
const BACKUP_FORMAT = 'rolling-budget-backup';
let installPrompt = null;
let showAllEntries = false;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  const button = document.querySelector('#install-button');
  if (button) button.hidden = false;
});

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Storage transaction was cancelled.'));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains('ledger')) database.createObjectStore('ledger', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function validTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function calendarDate(timezone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function daysBetween(from, to) {
  const ordinal = value => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return ordinal(to) - ordinal(from);
}

function id() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function initialize(database) {
  const transaction = database.transaction(['meta'], 'readwrite');
  const finished = transactionDone(transaction);
  const meta = transaction.objectStore('meta');
  let config = await requestResult(meta.get('config'));
  if (!config) {
    config = { key: 'config', dailyIncrementCents: 0, timezone: browserTimezone() };
    meta.put(config);
  }
  if (!validTimezone(config.timezone)) {
    config.timezone = browserTimezone();
    meta.put(config);
  }
  const last = await requestResult(meta.get('lastIncrementDate'));
  if (!last || !validCalendarDate(last.value)) {
    meta.put({ key: 'lastIncrementDate', value: calendarDate(config.timezone) });
  }
  await finished;
}

async function getConfig(database) {
  const transaction = database.transaction('meta', 'readonly');
  return requestResult(transaction.objectStore('meta').get('config'));
}

async function getEntries(database) {
  const transaction = database.transaction('ledger', 'readonly');
  const entries = await requestResult(transaction.objectStore('ledger').getAll());
  return entries.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id));
}

async function deleteEntry(database, entryId) {
  const transaction = database.transaction('ledger', 'readwrite');
  const finished = transactionDone(transaction);
  transaction.objectStore('ledger').delete(entryId);
  await finished;
}

async function applyDailyIncrement(database) {
  const transaction = database.transaction(['meta', 'ledger'], 'readwrite');
  const finished = transactionDone(transaction);
  const meta = transaction.objectStore('meta');
  const ledger = transaction.objectStore('ledger');
  const config = await requestResult(meta.get('config'));
  const state = await requestResult(meta.get('lastIncrementDate'));
  const today = calendarDate(config.timezone);
  const elapsed = daysBetween(state.value, today);

  if (elapsed > 0) {
    ledger.add({
      id: id(), type: 'increment', amountCents: config.dailyIncrementCents * elapsed,
      days: elapsed, dailyIncrementCents: config.dailyIncrementCents, vendor: '',
      description: elapsed === 1 ? 'Daily increment' : `Daily increment × ${elapsed}`,
      effectiveDate: today, createdAt: new Date().toISOString(),
    });
    meta.put({ key: 'lastIncrementDate', value: today });
  } else if (elapsed < 0) {
    meta.put({ key: 'lastIncrementDate', value: today });
  }
  await finished;
}

function money(cents) {
  const value = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
  return cents < 0 ? `−${formatted}` : formatted;
}

function dateLabel(date) {
  const [, month, day] = date.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} ${day}`;
}

function showNotice(message, error = false) {
  const host = document.querySelector('#notice');
  if (!host) return;
  host.replaceChildren();
  if (!message) return;
  const notice = document.createElement('p');
  notice.className = `notice${error ? ' error' : ''}`;
  notice.textContent = message;
  host.append(notice);
}

function entryRow(entry) {
  const item = document.createElement('li');
  const icon = document.createElement('div');
  icon.className = `entry-icon${entry.amountCents >= 0 ? ' plus' : ''}`;
  icon.textContent = entry.amountCents >= 0 ? '+' : '−';
  const copy = document.createElement('div');
  copy.className = 'entry-copy';
  const title = document.createElement('strong');
  title.textContent = entry.type === 'spend' ? entry.vendor : entry.description;
  const detail = document.createElement('span');
  detail.textContent = entry.type === 'spend' ? (entry.description || dateLabel(entry.effectiveDate)) : dateLabel(entry.effectiveDate);
  copy.append(title, detail);
  const amount = document.createElement('strong');
  amount.className = `entry-amount ${entry.amountCents < 0 ? 'negative' : 'positive'}`;
  amount.textContent = money(entry.amountCents);
  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete-entry';
  deleteButton.dataset.entryId = entry.id;
  deleteButton.setAttribute('aria-label', 'Delete ' + title.textContent + ' entry');
  deleteButton.textContent = 'Delete';
  actions.append(amount, deleteButton);
  item.append(icon, copy, actions);
  return item;
}

async function renderEntryPage(database) {
  const [config, entries] = await Promise.all([getConfig(database), getEntries(database)]);
  const balance = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  const balanceElement = document.querySelector('#balance');
  balanceElement.textContent = money(balance);
  balanceElement.classList.toggle('negative', balance < 0);
  document.querySelector('#daily-rate').textContent = `${money(config.dailyIncrementCents)} added each day`;
  const toggle = document.querySelector('#activity-toggle');
  toggle.hidden = entries.length <= 5;
  toggle.textContent = showAllEntries ? 'Show recent' : 'Show all (' + entries.length + ')';
  const recent = document.querySelector('#recent');
  recent.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Your activity will show up here.';
    recent.append(empty);
    return;
  }
  const list = document.createElement('ol');
  list.className = 'ledger';
  const visibleEntries = showAllEntries ? entries : entries.slice(-5);
  for (const entry of [...visibleEntries].reverse()) list.append(entryRow(entry));
  recent.append(list);
}

async function addExpense(database, form) {
  await applyDailyIncrement(database);
  const values = new FormData(form);
  const amount = Number(values.get('amount'));
  const vendor = String(values.get('vendor') || '').trim();
  const description = String(values.get('description') || '').trim();
  if (!Number.isFinite(amount) || amount === 0 || !vendor) throw new Error('Enter a non-zero amount and a vendor.');
  const amountCents = Math.round(amount * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) throw new Error('Enter a valid non-zero amount.');
  const config = await getConfig(database);
  const transaction = database.transaction('ledger', 'readwrite');
  const finished = transactionDone(transaction);
  transaction.objectStore('ledger').add({
    id: id(), type: 'spend', amountCents: -amountCents, vendor: vendor.slice(0, 100),
    description: description.slice(0, 240), effectiveDate: calendarDate(config.timezone), createdAt: new Date().toISOString(),
  });
  await finished;
}

function availableTimezones(current) {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [current, 'UTC'];
  return [...new Set([...zones, current])].sort();
}

async function renderSettingsPage(database) {
  const [config, entries] = await Promise.all([getConfig(database), getEntries(database)]);
  const form = document.querySelector('#settings-form');
  form.elements.dailyIncrement.value = (config.dailyIncrementCents / 100).toFixed(2);
  const select = form.elements.timezone;
  select.replaceChildren(...availableTimezones(config.timezone).map(zone => {
    const option = document.createElement('option');
    option.value = zone;
    option.textContent = zone.replaceAll('_', ' ');
    option.selected = zone === config.timezone;
    return option;
  }));
  const today = calendarDate(config.timezone);
  document.querySelector('#credit-today-row').hidden = entries.some(entry => entry.type === 'increment' && entry.effectiveDate === today);
}

async function saveSettings(database, form) {
  await applyDailyIncrement(database);
  const values = new FormData(form);
  const amount = Number(values.get('dailyIncrement'));
  const timezone = String(values.get('timezone'));
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter zero or a positive amount.');
  if (!validTimezone(timezone)) throw new Error('Choose a valid timezone.');
  const dailyIncrementCents = Math.round(amount * 100);
  if (!Number.isSafeInteger(dailyIncrementCents)) throw new Error('That daily amount is too large.');
  const today = calendarDate(timezone);
  const transaction = database.transaction(['meta', 'ledger'], 'readwrite');
  const finished = transactionDone(transaction);
  const meta = transaction.objectStore('meta');
  const ledger = transaction.objectStore('ledger');
  meta.put({ key: 'config', dailyIncrementCents, timezone });
  meta.put({ key: 'lastIncrementDate', value: today });
  if (values.get('creditToday')) {
    const entries = await requestResult(ledger.getAll());
    if (!entries.some(entry => entry.type === 'increment' && entry.effectiveDate === today)) {
      ledger.add({
        id: id(), type: 'increment', amountCents: dailyIncrementCents, days: 1, dailyIncrementCents,
        vendor: '', description: 'Starting daily increment', effectiveDate: today, createdAt: new Date().toISOString(),
      });
    }
  }
  await finished;
}

async function setBalance(database, form) {
  await applyDailyIncrement(database);
  const target = Number(new FormData(form).get('balance'));
  const targetCents = Math.round(target * 100);
  if (!Number.isFinite(target) || !Number.isSafeInteger(targetCents)) throw new Error('Enter a valid balance.');
  const config = await getConfig(database);
  const transaction = database.transaction('ledger', 'readwrite');
  const finished = transactionDone(transaction);
  const ledger = transaction.objectStore('ledger');
  const entries = await requestResult(ledger.getAll());
  const currentCents = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  const difference = targetCents - currentCents;
  if (difference !== 0) {
    ledger.add({
      id: id(), type: 'adjustment', amountCents: difference, vendor: '', description: 'Balance adjustment',
      effectiveDate: calendarDate(config.timezone), createdAt: new Date().toISOString(),
    });
  }
  await finished;
}

function download(name, type, contents) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadBackup(database) {
  const transaction = database.transaction(['meta', 'ledger'], 'readonly');
  const config = await requestResult(transaction.objectStore('meta').get('config'));
  const state = await requestResult(transaction.objectStore('meta').get('lastIncrementDate'));
  const entries = await requestResult(transaction.objectStore('ledger').getAll());
  const backup = { format: BACKUP_FORMAT, version: 2, exportedAt: new Date().toISOString(), config, lastIncrementDate: state.value, entries };
  download(`rolling-budget-backup-${calendarDate(config.timezone)}.json`, 'application/json', `${JSON.stringify(backup, null, 2)}\n`);
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

async function downloadCsv(database) {
  const [config, entries] = await Promise.all([getConfig(database), getEntries(database)]);
  const rows = [['date', 'type', 'amount', 'vendor', 'description', 'days', 'daily_increment', 'recorded_at']];
  for (const entry of entries) rows.push([
    entry.effectiveDate, entry.type, (entry.amountCents / 100).toFixed(2), entry.vendor, entry.description,
    entry.days ?? '', entry.dailyIncrementCents == null ? '' : (entry.dailyIncrementCents / 100).toFixed(2), entry.createdAt,
  ]);
  download(`rolling-budget-${calendarDate(config.timezone)}.csv`, 'text/csv;charset=utf-8', `\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`);
}

function validateBackup(backup) {
  if (backup?.format !== BACKUP_FORMAT || backup.version !== 2 || !backup.config || !Array.isArray(backup.entries)) throw new Error('That is not a valid Rolling Budget backup.');
  if (!Number.isSafeInteger(backup.config.dailyIncrementCents) || backup.config.dailyIncrementCents < 0 || !validTimezone(backup.config.timezone)) throw new Error('The backup settings are invalid.');
  if (!validCalendarDate(backup.lastIncrementDate)) throw new Error('The backup date is invalid.');
  for (const entry of backup.entries) {
    if (!entry || typeof entry.id !== 'string' || !['increment', 'spend', 'adjustment'].includes(entry.type)
      || !Number.isSafeInteger(entry.amountCents) || !validCalendarDate(entry.effectiveDate)) {
      throw new Error('The backup contains an invalid ledger entry.');
    }
  }
}

async function restoreBackup(database, file) {
  if (!file || file.size > 10_000_000) throw new Error('Choose a backup file smaller than 10 MB.');
  let backup;
  try { backup = JSON.parse(await file.text()); } catch { throw new Error('The backup is not valid JSON.'); }
  validateBackup(backup);
  const transaction = database.transaction(['meta', 'ledger'], 'readwrite');
  const finished = transactionDone(transaction);
  const meta = transaction.objectStore('meta');
  const ledger = transaction.objectStore('ledger');
  meta.clear();
  ledger.clear();
  meta.put({ ...backup.config, key: 'config' });
  meta.put({ key: 'lastIncrementDate', value: backup.lastIncrementDate });
  for (const entry of backup.entries) ledger.add(entry);
  await finished;
}

async function entryPage(database) {
  await renderEntryPage(database);
  document.querySelector('#activity-toggle').addEventListener('click', async () => {
    showAllEntries = !showAllEntries;
    await renderEntryPage(database);
  });
  document.querySelector('#recent').addEventListener('click', async event => {
    const button = event.target.closest('.delete-entry');
    if (!button || !window.confirm('Delete this ledger entry? Your balance will update immediately.')) return;
    button.disabled = true;
    try {
      await deleteEntry(database, button.dataset.entryId);
      showNotice('Transaction deleted.');
      await renderEntryPage(database);
    } catch (error) {
      button.disabled = false;
      showNotice(error.message || 'Could not delete the transaction.', true);
    }
  });
  document.querySelector('#expense-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await addExpense(database, form);
      form.reset();
      showNotice('Expense saved.');
      await renderEntryPage(database);
      navigator.storage?.persist?.();
    } catch (error) {
      showNotice(error.message || 'Could not save the expense.', true);
    } finally {
      button.disabled = false;
    }
  });
}

async function settingsPage(database) {
  await renderSettingsPage(database);
  document.querySelector('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await saveSettings(database, form);
      showNotice('Daily increment saved.');
      await renderSettingsPage(database);
      navigator.storage?.persist?.();
    } catch (error) {
      showNotice(error.message || 'Could not save the settings.', true);
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector('#download-csv').addEventListener('click', () => downloadCsv(database).catch(error => showNotice(error.message, true)));
  document.querySelector('#balance-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await setBalance(database, form);
      form.reset();
      showNotice('Balance adjusted.');
      navigator.storage?.persist?.();
    } catch (error) {
      showNotice(error.message || 'Could not adjust the balance.', true);
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector('#download-backup').addEventListener('click', () => downloadBackup(database).catch(error => showNotice(error.message, true)));
  document.querySelector('#restore-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await restoreBackup(database, form.elements.backup.files[0]);
      form.reset();
      showNotice('Backup restored.');
      await applyDailyIncrement(database);
      await renderSettingsPage(database);
    } catch (error) {
      showNotice(error.message || 'Could not restore the backup.', true);
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector('#install-button').addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = null;
    document.querySelector('#install-button').hidden = true;
  });
}

async function start() {
  try {
    const database = await openDatabase();
    await initialize(database);
    await applyDailyIncrement(database);
    if (document.body.dataset.page === 'entry') await entryPage(database);
    else await settingsPage(database);
  } catch (error) {
    showNotice(`Could not open local storage: ${error.message || error}`, true);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

start();
