/**
 * Api.gs
 * Seluruh business logic & validasi peran (role) aplikasi POS Warung.
 * Setiap fungsi di file ini adalah satu "action" yang bisa dipanggil dari frontend
 * lewat Code.gs -> doPost() -> Api[action].apply(null, args).
 *
 * Tidak boleh mengakses SpreadsheetApp/DriveApp secara langsung di sini.
 * Semua akses data HARUS lewat fungsi-fungsi di Database.gs
 * (getSheet, getSheetData, getNextId, findRowByValue, ts, isActive, sanitizeHtml,
 *  getDriveFolder, uploadToDrive, deleteFromDrive).
 *
 * CATATAN: setupDemoData() di bagian bawah file ini SENGAJA TIDAK didaftarkan
 * di ALLOWED_ACTIONS (Code.gs) karena fungsi ini menghapus seluruh sheet yang ada.
 * Jalankan manual dari editor Apps Script (Run > setupDemoData), jangan diekspos ke publik.
 */

function getUsernameById(uid) {
  const r = findRowByValue(SHEETS.USERS, U.ID, parseInt(uid));
  return r ? r.data[U.NAME] : 'Tidak diketahui';
}

function getMenuCountForCat(catId) {
  try {
    const data = getSheetData(SHEETS.MENU_ITEMS);
    return data.filter(r => r[MI.CAT_ID] == catId).length;
  } catch(e) { return 0; }
}

function saveBusinessLogo(logoData, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa mengubah logo' };
    if (!logoData || !logoData.data) return { success: false, message: 'Logo tidak valid' };
    const folderName = 'RestoPOS_Branding';
    const fileId = uploadToDrive(logoData.data, logoData.name || 'logo.png', logoData.type || 'image/png', folderName);
    const currentSettings = getSettings().data || {};
    if (currentSettings.business_logo) deleteFromDrive(currentSettings.business_logo);
    saveSetting('business_logo', fileId, userId);
    return { success: true, message: 'Logo warung berhasil disimpan', data: { fileId: fileId } };
  } catch (e) { console.error('saveBusinessLogo:', e); return { success: false, message: 'Gagal menyimpan logo' }; }
}

function removeBusinessLogo(userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa menghapus logo' };
    const currentSettings = getSettings().data || {};
    if (currentSettings.business_logo) deleteFromDrive(currentSettings.business_logo);
    saveSetting('business_logo', '', userId);
    return { success: true, message: 'Logo warung berhasil dihapus' };
  } catch (e) { console.error('removeBusinessLogo:', e); return { success: false, message: 'Gagal menghapus logo' }; }
}

function login(email, password) {
  try {
    if (!email || !password) return { success: false, message: 'Email dan kata sandi wajib diisi' };
    const r = findRowByValue(SHEETS.USERS, U.EMAIL, email.trim().toLowerCase());
    if (!r) return { success: false, message: 'Email atau kata sandi salah' };
    const u = r.data;
    if (!isActive(u[U.ACTIVE])) return { success: false, message: 'Akun tidak aktif. Hubungi admin.' };
    if (password !== u[U.PWD]) return { success: false, message: 'Email atau kata sandi salah' };
    getSheet(SHEETS.USERS).getRange(r.row, U.UPDATED + 1).setValue(ts());
    logActivity(u[U.ID], 'LOGIN', 'Users', u[U.ID], '');
    return {
      success: true, message: 'Login berhasil',
      data: { id: u[U.ID], full_name: u[U.NAME], email: u[U.EMAIL], role: u[U.ROLE], avatar: u[U.AVATAR] || '' }
    };
  } catch (e) { console.error('login:', e); return { success: false, message: 'Login gagal' }; }
}

function getUsers(userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Akses ditolak' };
    const data = getSheetData(SHEETS.USERS);
    const users = data.map(r => ({
      id: r[U.ID], full_name: r[U.NAME], email: r[U.EMAIL], phone: r[U.PHONE] || '',
      role: r[U.ROLE], avatar: r[U.AVATAR] || '',
      is_active: isActive(r[U.ACTIVE]) ? 1 : 0,
      created_at: r[U.CREATED] instanceof Date ? r[U.CREATED].toISOString() : r[U.CREATED],
      updated_at: r[U.UPDATED] instanceof Date ? r[U.UPDATED].toISOString() : r[U.UPDATED] || ''
    }));
    return { success: true, data: users.reverse() };
  } catch (e) { console.error('getUsers:', e); return { success: false, message: 'Gagal memuat pengguna' }; }
}

function addUser(userData, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Akses ditolak' };
    const { full_name, email, phone, password, userRole, avatarData } = userData;
    if (!full_name || !email || !password) return { success: false, message: 'Nama, email, dan kata sandi wajib diisi' };
    if (password.length < 6) return { success: false, message: 'Kata sandi minimal 6 karakter' };
    const existing = findRowByValue(SHEETS.USERS, U.EMAIL, email.trim().toLowerCase());
    if (existing) return { success: false, message: 'Email sudah terdaftar' };
    let avatarId = '';
    if (avatarData && avatarData.data) avatarId = uploadToDrive(avatarData.data, avatarData.name, avatarData.type);
    const sh = getSheet(SHEETS.USERS);
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const newId = getNextId(SHEETS.USERS); const now = ts();
      sh.appendRow([newId, full_name.trim(), email.trim().toLowerCase(), phone || '', password, userRole || 'kasir', avatarId, 1, now, now, '', '']);
      logActivity(userId, 'CREATE', 'Users', newId, 'Menambahkan: ' + full_name.trim());
      return { success: true, message: 'Pengguna berhasil ditambahkan', data: { id: newId } };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('addUser:', e); return { success: false, message: 'Gagal menambahkan pengguna' }; }
}

function updateUser(userData, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Akses ditolak' };
    const { id, full_name, email, phone, password, userRole, is_active, avatarData, removeAvatar } = userData;
    if (!id || !full_name || !email) return { success: false, message: 'Nama dan email wajib diisi' };
    const r = findRowByValue(SHEETS.USERS, U.ID, parseInt(id));
    if (!r) return { success: false, message: 'Pengguna tidak ditemukan' };
    const ec = findRowByValue(SHEETS.USERS, U.EMAIL, email.trim().toLowerCase());
    if (ec && ec.data[U.ID] != parseInt(id)) return { success: false, message: 'Email sudah digunakan' };
    const sh = getSheet(SHEETS.USERS);
    const row = r.data.slice();
    row[U.NAME] = full_name.trim(); row[U.EMAIL] = email.trim().toLowerCase(); row[U.PHONE] = phone || '';
    row[U.ROLE] = userRole || 'kasir'; row[U.ACTIVE] = (is_active == 1 || is_active === true) ? 1 : 0;
    if (password && password.length >= 6) row[U.PWD] = password;
    if (avatarData && avatarData.data) { if (row[U.AVATAR]) deleteFromDrive(row[U.AVATAR]); row[U.AVATAR] = uploadToDrive(avatarData.data, avatarData.name, avatarData.type); }
    else if (removeAvatar) { if (row[U.AVATAR]) deleteFromDrive(row[U.AVATAR]); row[U.AVATAR] = ''; }
    row[U.UPDATED] = ts();
    sh.getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'UPDATE', 'Users', parseInt(id), 'Memperbarui: ' + full_name.trim());
    return { success: true, message: 'Pengguna berhasil diperbarui' };
  } catch (e) { console.error('updateUser:', e); return { success: false, message: 'Gagal memperbarui pengguna' }; }
}

function deleteUser(id, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Akses ditolak' };
    if (parseInt(id) === parseInt(userId)) return { success: false, message: 'Tidak bisa menghapus akun sendiri' };
    const r = findRowByValue(SHEETS.USERS, U.ID, parseInt(id));
    if (!r) return { success: false, message: 'Pengguna tidak ditemukan' };
    if (r.data[U.AVATAR]) deleteFromDrive(r.data[U.AVATAR]);
    const name = r.data[U.NAME];
    getSheet(SHEETS.USERS).deleteRow(r.row);
    logActivity(userId, 'DELETE', 'Users', parseInt(id), 'Menghapus: ' + name);
    return { success: true, message: 'Pengguna berhasil dihapus' };
  } catch (e) { console.error('deleteUser:', e); return { success: false, message: 'Gagal menghapus pengguna' }; }
}

function toggleUserStatus(id, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Akses ditolak' };
    if (parseInt(id) === parseInt(userId)) return { success: false, message: 'Tidak bisa mengubah status sendiri' };
    const r = findRowByValue(SHEETS.USERS, U.ID, parseInt(id));
    if (!r) return { success: false, message: 'Pengguna tidak ditemukan' };
    const row = r.data.slice();
    const was = isActive(row[U.ACTIVE]);
    row[U.ACTIVE] = was ? 0 : 1; row[U.UPDATED] = ts();
    getSheet(SHEETS.USERS).getRange(r.row, 1, 1, row.length).setValues([row]);
    const status = was ? 'Dinonaktifkan' : 'Diaktifkan';
    logActivity(userId, 'TOGGLE_STATUS', 'Users', parseInt(id), status + ': ' + r.data[U.NAME]);
    return { success: true, message: 'Pengguna ' + status.toLowerCase(), data: { is_active: was ? 0 : 1 } };
  } catch (e) { console.error('toggleUserStatus:', e); return { success: false, message: 'Gagal mengubah status' }; }
}

function getProfile(userId) {
  try {
    const r = findRowByValue(SHEETS.USERS, U.ID, parseInt(userId));
    if (!r) return { success: false, message: 'Pengguna tidak ditemukan' };
    const u = r.data;
    return { success: true, data: {
      id: u[U.ID], full_name: u[U.NAME], email: u[U.EMAIL], phone: u[U.PHONE] || '',
      role: u[U.ROLE], avatar: u[U.AVATAR] || '', is_active: isActive(u[U.ACTIVE]) ? 1 : 0,
      created_at: u[U.CREATED] instanceof Date ? u[U.CREATED].toISOString() : u[U.CREATED]
    }};
  } catch (e) { return { success: false, message: 'Gagal memuat profil' }; }
}

function updateProfile(profileData, userId) {
  try {
    const { full_name, phone, avatarData, removeAvatar } = profileData;
    if (!full_name) return { success: false, message: 'Nama wajib diisi' };
    const r = findRowByValue(SHEETS.USERS, U.ID, parseInt(userId));
    if (!r) return { success: false, message: 'Pengguna tidak ditemukan' };
    const row = r.data.slice();
    row[U.NAME] = full_name.trim(); row[U.PHONE] = phone || '';
    if (avatarData && avatarData.data) { if (row[U.AVATAR]) deleteFromDrive(row[U.AVATAR]); row[U.AVATAR] = uploadToDrive(avatarData.data, avatarData.name, avatarData.type); }
    else if (removeAvatar) { if (row[U.AVATAR]) deleteFromDrive(row[U.AVATAR]); row[U.AVATAR] = ''; }
    row[U.UPDATED] = ts();
    getSheet(SHEETS.USERS).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'UPDATE', 'Users', parseInt(userId), 'Memperbarui profil sendiri');
    return { success: true, message: 'Profil diperbarui', data: { full_name: full_name.trim(), phone: phone || '', avatar: row[U.AVATAR] } };
  } catch (e) { return { success: false, message: 'Gagal memperbarui profil' }; }
}

function changePassword(userId, currentPassword, newPassword) {
  try {
    if (!newPassword || newPassword.length < 6) return { success: false, message: 'Kata sandi baru minimal 6 karakter' };
    const r = findRowByValue(SHEETS.USERS, U.ID, parseInt(userId));
    if (!r) return { success: false, message: 'Pengguna tidak ditemukan' };
    if (currentPassword !== r.data[U.PWD]) return { success: false, message: 'Kata sandi saat ini salah' };
    getSheet(SHEETS.USERS).getRange(r.row, U.PWD + 1).setValue(newPassword);
    logActivity(userId, 'CHANGE_PWD', 'Users', parseInt(userId), '');
    return { success: true, message: 'Kata sandi berhasil diubah' };
  } catch (e) { return { success: false, message: 'Gagal mengubah kata sandi' }; }
}

function sendForgotOTP(email) {
  try {
    if (!email) return { success: false, message: 'Email wajib diisi' };
    const e = email.trim().toLowerCase();
    const r = findRowByValue(SHEETS.USERS, U.EMAIL, e);
    if (!r) return { success: false, message: 'Akun dengan email ini tidak ditemukan' };
    if (!isActive(r.data[U.ACTIVE])) return { success: false, message: 'Akun tidak aktif. Hubungi admin.' };
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const exp = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const sh = getSheet(SHEETS.USERS);
    sh.getRange(r.row, U.OTP + 1).setValue(otp);
    sh.getRange(r.row, U.OTP_EXP + 1).setValue(exp);
    try {
      const settings = getSettings().data || {};
      const bizName = settings.business_name || 'POS Restoran';
      const subject = bizName + ' — Kode Reset Kata Sandi';
      const body = 'Halo ' + r.data[U.NAME] + ',\n\nKode reset kata sandi Anda: ' + otp + '\n\nKode ini berlaku 10 menit.\n\nAbaikan email ini jika Anda tidak meminta reset kata sandi.\n\n— ' + bizName;
      const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f5f7fa">' +
        '<div style="background:white;padding:32px;border-radius:10px;border-top:4px solid #1463f6;box-shadow:0 2px 12px rgba(0,0,0,0.06)">' +
        '<h2 style="color:#1463f6;margin:0 0 6px;font-size:22px">Kode Reset Kata Sandi</h2>' +
        '<p style="color:#666;margin:0 0 22px;font-size:13px">Halo ' + sanitizeHtml(r.data[U.NAME]) + ',</p>' +
        '<p style="color:#444;margin:0 0 12px;font-size:14px">Gunakan kode sekali-pakai di bawah untuk mereset kata sandi Anda:</p>' +
        '<div style="background:#fdf0ee;border:1px dashed #e0b0aa;border-radius:8px;padding:20px;text-align:center;font-size:34px;font-weight:700;color:#1463f6;letter-spacing:10px;margin:16px 0;font-family:monospace">' + otp + '</div>' +
        '<p style="color:#888;font-size:13px;margin:12px 0 8px">Kode ini berlaku selama <strong>10 menit</strong>.</p>' +
        '<p style="color:#888;font-size:13px;margin:0">Abaikan email ini jika Anda tidak meminta reset kata sandi.</p>' +
        '<hr style="border:none;border-top:1px solid #eee;margin:22px 0">' +
        '<p style="color:#aaa;font-size:11px;margin:0">— ' + sanitizeHtml(bizName) + '</p>' +
        '</div></div>';
      MailApp.sendEmail({ to: e, subject: subject, body: body, htmlBody: html });
    } catch (mailErr) { console.error('mail send:', mailErr); return { success: false, message: 'Gagal mengirim email. Periksa izin pengiriman email.' }; }
    logActivity(r.data[U.ID], 'FORGOT_PWD', 'Users', r.data[U.ID], 'OTP dikirim');
    return { success: true, message: 'Kode reset telah dikirim ke email Anda' };
  } catch (err) { console.error('sendForgotOTP:', err); return { success: false, message: 'Gagal mengirim kode' }; }
}

function verifyOTP(email, otp) {
  try {
    if (!email || !otp) return { success: false, message: 'Email dan kode wajib diisi' };
    const r = findRowByValue(SHEETS.USERS, U.EMAIL, email.trim().toLowerCase());
    if (!r) return { success: false, message: 'Permintaan tidak valid' };
    const stored = String(r.data[U.OTP] || '').trim();
    const expRaw = r.data[U.OTP_EXP];
    if (!stored) return { success: false, message: 'Belum ada kode diminta. Silakan minta kode baru.' };
    if (stored !== String(otp).trim()) return { success: false, message: 'Kode tidak valid' };
    const exp = expRaw instanceof Date ? expRaw : new Date(expRaw);
    if (isNaN(exp.getTime()) || Date.now() > exp.getTime()) return { success: false, message: 'Kode sudah kedaluwarsa. Minta kode baru.' };
    return { success: true, message: 'Kode terverifikasi' };
  } catch (err) { console.error('verifyOTP:', err); return { success: false, message: 'Verifikasi gagal' }; }
}

function resetPassword(email, otp, newPassword) {
  try {
    if (!email || !otp || !newPassword) return { success: false, message: 'Semua kolom wajib diisi' };
    if (newPassword.length < 6) return { success: false, message: 'Kata sandi minimal 6 karakter' };
    const v = verifyOTP(email, otp);
    if (!v.success) return v;
    const r = findRowByValue(SHEETS.USERS, U.EMAIL, email.trim().toLowerCase());
    if (!r) return { success: false, message: 'Pengguna tidak ditemukan' };
    const sh = getSheet(SHEETS.USERS);
    sh.getRange(r.row, U.PWD + 1).setValue(newPassword);
    sh.getRange(r.row, U.OTP + 1).setValue('');
    sh.getRange(r.row, U.OTP_EXP + 1).setValue('');
    sh.getRange(r.row, U.UPDATED + 1).setValue(ts());
    logActivity(r.data[U.ID], 'RESET_PWD', 'Users', r.data[U.ID], 'Kata sandi direset via OTP');
    return { success: true, message: 'Kata sandi berhasil direset. Silakan masuk kembali.' };
  } catch (err) { console.error('resetPassword:', err); return { success: false, message: 'Gagal mereset kata sandi' }; }
}

function getCategories(userId, role) {
  try {
    const data = getSheetData(SHEETS.CATEGORIES);
    const uData = getSheetData(SHEETS.USERS);
    const uMap = {}; uData.forEach(r => { uMap[r[U.ID]] = r[U.NAME]; });
    const miData = getSheetData(SHEETS.MENU_ITEMS);
    const miCountMap = {}; miData.forEach(r => { const cid = r[MI.CAT_ID]; miCountMap[cid] = (miCountMap[cid] || 0) + 1; });
    const cats = data.map(r => ({
      id: r[C.ID], name: r[C.NAME], description: r[C.DESC] || '',
      is_active: isActive(r[C.ACTIVE]) ? 1 : 0, created_by: r[C.CREATED_BY],
      created_by_name: uMap[r[C.CREATED_BY]] || 'Tidak diketahui',
      menu_count: miCountMap[r[C.ID]] || 0,
      created_at: r[C.CREATED] instanceof Date ? r[C.CREATED].toISOString() : r[C.CREATED]
    }));
    return { success: true, data: cats.reverse() };
  } catch (e) { console.error('getCategories:', e); return { success: false, message: 'Gagal memuat kategori' }; }
}

function addCategory(catData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { name, description } = catData;
    if (!name) return { success: false, message: 'Nama kategori wajib diisi' };
    const existing = findRowByValue(SHEETS.CATEGORIES, C.NAME, name.trim());
    if (existing) return { success: false, message: 'Nama kategori sudah ada' };
    const sh = getSheet(SHEETS.CATEGORIES);
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const newId = getNextId(SHEETS.CATEGORIES);
      sh.appendRow([newId, name.trim(), description || '', 1, userId, ts()]);
      logActivity(userId, 'CREATE', 'Categories', newId, 'Menambahkan: ' + name.trim());
      return { success: true, message: 'Kategori berhasil ditambahkan', data: { id: newId } };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('addCategory:', e); return { success: false, message: 'Gagal menambahkan kategori' }; }
}

function updateCategory(catData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { id, name, description, is_active } = catData;
    if (!id || !name) return { success: false, message: 'Nama wajib diisi' };
    const r = findRowByValue(SHEETS.CATEGORIES, C.ID, parseInt(id));
    if (!r) return { success: false, message: 'Kategori tidak ditemukan' };
    const nc = findRowByValue(SHEETS.CATEGORIES, C.NAME, name.trim());
    if (nc && nc.data[C.ID] != parseInt(id)) return { success: false, message: 'Nama kategori sudah ada' };
    const row = r.data.slice();
    row[C.NAME] = name.trim(); row[C.DESC] = description || '';
    row[C.ACTIVE] = (is_active == 1 || is_active === true) ? 1 : 0;
    getSheet(SHEETS.CATEGORIES).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'UPDATE', 'Categories', parseInt(id), 'Memperbarui: ' + name.trim());
    return { success: true, message: 'Kategori berhasil diperbarui' };
  } catch (e) { console.error('updateCategory:', e); return { success: false, message: 'Gagal memperbarui kategori' }; }
}

function deleteCategory(id, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa menghapus kategori' };
    const r = findRowByValue(SHEETS.CATEGORIES, C.ID, parseInt(id));
    if (!r) return { success: false, message: 'Kategori tidak ditemukan' };
    if (getMenuCountForCat(parseInt(id)) > 0) return { success: false, message: 'Tidak bisa dihapus — masih ada menu terkait' };
    const name = r.data[C.NAME];
    getSheet(SHEETS.CATEGORIES).deleteRow(r.row);
    logActivity(userId, 'DELETE', 'Categories', parseInt(id), 'Menghapus: ' + name);
    return { success: true, message: 'Kategori berhasil dihapus' };
  } catch (e) { console.error('deleteCategory:', e); return { success: false, message: 'Gagal menghapus kategori' }; }
}

function toggleCategoryStatus(id, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const r = findRowByValue(SHEETS.CATEGORIES, C.ID, parseInt(id));
    if (!r) return { success: false, message: 'Kategori tidak ditemukan' };
    const row = r.data.slice();
    const was = isActive(row[C.ACTIVE]);
    row[C.ACTIVE] = was ? 0 : 1;
    getSheet(SHEETS.CATEGORIES).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'TOGGLE_STATUS', 'Categories', parseInt(id), (was ? 'Dinonaktifkan' : 'Diaktifkan') + ': ' + r.data[C.NAME]);
    return { success: true, message: 'Kategori ' + (was ? 'dinonaktifkan' : 'diaktifkan') };
  } catch (e) { return { success: false, message: 'Gagal mengubah status' }; }
}

function checkCategoryName(name, excludeId) {
  try {
    if (!name) return { success: true, exists: false };
    const r = findRowByValue(SHEETS.CATEGORIES, C.NAME, name.trim());
    if (r && (!excludeId || r.data[C.ID] != parseInt(excludeId))) return { success: true, exists: true };
    return { success: true, exists: false };
  } catch (e) { return { success: true, exists: false }; }
}

function getCategoriesForDropdown() {
  try {
    const data = getSheetData(SHEETS.CATEGORIES);
    return { success: true, data: data.filter(r => isActive(r[C.ACTIVE])).map(r => ({ id: r[C.ID], name: r[C.NAME] })) };
  } catch (e) { return { success: true, data: [] }; }
}

function buildPurchaseStatsMap() {
  const m = {};
  try {
    const data = getSheetData(SHEETS.PURCHASES);
    data.forEach(r => {
      const sid = r[PU.SUPPLIER_ID];
      if (!m[sid]) m[sid] = { count: 0, totalAmt: 0, paidAmt: 0 };
      m[sid].count++;
      m[sid].totalAmt += (parseFloat(r[PU.TOTAL]) || 0);
      m[sid].paidAmt += (parseFloat(r[PU.PAID]) || 0);
    });
  } catch(e) {}
  return m;
}

function getPurchaseCountForSupplier(suppId) {
  try {
    const data = getSheetData(SHEETS.PURCHASES);
    return data.filter(r => r[PU.SUPPLIER_ID] == suppId).length;
  } catch(e) { return 0; }
}

function getSuppliers(userId, role) {
  try {
    if (role === 'kasir') return { success: false, message: 'Akses ditolak' };
    const data = getSheetData(SHEETS.SUPPLIERS);
    const puMap = buildPurchaseStatsMap();
    const uData = getSheetData(SHEETS.USERS);
    const uMap = {}; uData.forEach(r => { uMap[r[U.ID]] = r[U.NAME]; });
    const suppliers = data.map(r => {
      const pu = puMap[r[SP.ID]] || { count: 0, totalAmt: 0, paidAmt: 0 };
      return {
        id: r[SP.ID], name: r[SP.NAME], phone: r[SP.PHONE] || '', address: r[SP.ADDR] || '',
        is_active: isActive(r[SP.ACTIVE]) ? 1 : 0, created_by: r[SP.CREATED_BY],
        created_by_name: uMap[r[SP.CREATED_BY]] || 'Tidak diketahui',
        purchase_count: pu.count, total_paid: Math.round(pu.paidAmt * 100) / 100,
        total_due: Math.round((pu.totalAmt - pu.paidAmt) * 100) / 100,
        created_at: r[SP.CREATED] instanceof Date ? r[SP.CREATED].toISOString() : r[SP.CREATED]
      };
    });
    return { success: true, data: suppliers.reverse() };
  } catch (e) { console.error('getSuppliers:', e); return { success: false, message: 'Gagal memuat supplier' }; }
}

function addSupplier(spData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { name, phone, address } = spData;
    if (!name) return { success: false, message: 'Nama supplier wajib diisi' };
    const sh = getSheet(SHEETS.SUPPLIERS);
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const newId = getNextId(SHEETS.SUPPLIERS);
      sh.appendRow([newId, name.trim(), phone || '', address || '', 1, userId, ts()]);
      logActivity(userId, 'CREATE', 'Suppliers', newId, 'Menambahkan: ' + name.trim());
      return { success: true, message: 'Supplier berhasil ditambahkan', data: { id: newId } };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('addSupplier:', e); return { success: false, message: 'Gagal menambahkan supplier' }; }
}

function updateSupplier(spData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { id, name, phone, address, is_active } = spData;
    if (!id || !name) return { success: false, message: 'Nama wajib diisi' };
    const r = findRowByValue(SHEETS.SUPPLIERS, SP.ID, parseInt(id));
    if (!r) return { success: false, message: 'Supplier tidak ditemukan' };
    const row = r.data.slice();
    row[SP.NAME] = name.trim(); row[SP.PHONE] = phone || ''; row[SP.ADDR] = address || '';
    row[SP.ACTIVE] = (is_active == 1 || is_active === true) ? 1 : 0;
    getSheet(SHEETS.SUPPLIERS).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'UPDATE', 'Suppliers', parseInt(id), 'Memperbarui: ' + name.trim());
    return { success: true, message: 'Supplier berhasil diperbarui' };
  } catch (e) { console.error('updateSupplier:', e); return { success: false, message: 'Gagal memperbarui supplier' }; }
}

function deleteSupplier(id, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa menghapus supplier' };
    const r = findRowByValue(SHEETS.SUPPLIERS, SP.ID, parseInt(id));
    if (!r) return { success: false, message: 'Supplier tidak ditemukan' };
    if (getPurchaseCountForSupplier(parseInt(id)) > 0) return { success: false, message: 'Tidak bisa dihapus — masih ada pembelian terkait' };
    const name = r.data[SP.NAME];
    getSheet(SHEETS.SUPPLIERS).deleteRow(r.row);
    logActivity(userId, 'DELETE', 'Suppliers', parseInt(id), 'Menghapus: ' + name);
    return { success: true, message: 'Supplier berhasil dihapus' };
  } catch (e) { console.error('deleteSupplier:', e); return { success: false, message: 'Gagal menghapus supplier' }; }
}

function toggleSupplierStatus(id, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const r = findRowByValue(SHEETS.SUPPLIERS, SP.ID, parseInt(id));
    if (!r) return { success: false, message: 'Supplier tidak ditemukan' };
    const row = r.data.slice();
    const was = isActive(row[SP.ACTIVE]);
    row[SP.ACTIVE] = was ? 0 : 1;
    getSheet(SHEETS.SUPPLIERS).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'TOGGLE_STATUS', 'Suppliers', parseInt(id), (was ? 'Dinonaktifkan' : 'Diaktifkan') + ': ' + r.data[SP.NAME]);
    return { success: true, message: 'Supplier ' + (was ? 'dinonaktifkan' : 'diaktifkan') };
  } catch (e) { return { success: false, message: 'Gagal mengubah status' }; }
}

function getSupplierLedger(supplierId, userId, role) {
  try {
    if (role === 'kasir') return { success: false, message: 'Akses ditolak' };
    const sr = findRowByValue(SHEETS.SUPPLIERS, SP.ID, parseInt(supplierId));
    if (!sr) return { success: false, message: 'Supplier tidak ditemukan' };
    const supplier = { id: sr.data[SP.ID], name: sr.data[SP.NAME], phone: sr.data[SP.PHONE] || '', address: sr.data[SP.ADDR] || '' };
    let ledger = [];
    try {
      const data = getSheetData(SHEETS.PURCHASES);
      let balance = 0;
      ledger = data.filter(r => r[PU.SUPPLIER_ID] == parseInt(supplierId)).map(r => {
        const total = parseFloat(r[PU.TOTAL]) || 0;
        const paid = parseFloat(r[PU.PAID]) || 0;
        balance += (total - paid);
        return {
          id: r[PU.ID], purchase_no: r[PU.NO],
          date: r[PU.DATE] instanceof Date ? r[PU.DATE].toISOString().split('T')[0] : (r[PU.DATE] || ''),
          item_name: r[PU.ITEM] || '',
          total_amount: total, paid_amount: paid, due: Math.round((total - paid) * 100) / 100,
          balance: Math.round(balance * 100) / 100, status: r[PU.STATUS] || 'pending'
        };
      });
    } catch(e) {}
    return { success: true, data: { supplier, ledger } };
  } catch (e) { console.error('getSupplierLedger:', e); return { success: false, message: 'Gagal memuat kartu hutang' }; }
}

function genPurchaseNo() {
  const d = new Date();
  const dt = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const data = getSheetData(SHEETS.PURCHASES);
  const today = data.filter(r => String(r[PU.NO]).includes(dt));
  const maxSeq = today.reduce((m, r) => { const parts = String(r[PU.NO]).split('-'); return Math.max(m, parseInt(parts[parts.length-1]) || 0); }, 0);
  const prefix = (getSettings().data || {}).purchase_prefix || 'BELI';
  return prefix + '-' + dt + '-' + String(maxSeq + 1).padStart(3, '0');
}

function getPurchases(userId, role) {
  try {
    if (role === 'kasir') return { success: false, message: 'Akses ditolak' };
    const data = getSheetData(SHEETS.PURCHASES);
    const spData = getSheetData(SHEETS.SUPPLIERS);
    const uData = getSheetData(SHEETS.USERS);
    const spMap = {}; spData.forEach(r => { spMap[r[SP.ID]] = r[SP.NAME]; });
    const uMap = {}; uData.forEach(r => { uMap[r[U.ID]] = r[U.NAME]; });
    const purchases = data.map(r => ({
      id: r[PU.ID], purchase_no: r[PU.NO],
      supplier_id: r[PU.SUPPLIER_ID], supplier_name: spMap[r[PU.SUPPLIER_ID]] || 'Tidak diketahui',
      item_name: r[PU.ITEM] || '', qty: parseFloat(r[PU.QTY]) || 0, unit: r[PU.UNIT] || '',
      unit_price: parseFloat(r[PU.UNIT_PRICE]) || 0, total_amount: parseFloat(r[PU.TOTAL]) || 0,
      paid_amount: parseFloat(r[PU.PAID]) || 0, due_amount: parseFloat(r[PU.DUE]) || 0,
      purchase_date: r[PU.DATE] instanceof Date ? r[PU.DATE].toISOString().split('T')[0] : (r[PU.DATE] || ''),
      notes: r[PU.NOTES] || '', status: r[PU.STATUS] || 'pending',
      created_by_name: uMap[r[PU.CREATED_BY]] || 'Tidak diketahui',
      created_at: r[PU.CREATED] instanceof Date ? r[PU.CREATED].toISOString() : r[PU.CREATED]
    }));
    return { success: true, data: purchases.reverse() };
  } catch (e) { console.error('getPurchases:', e); return { success: false, message: 'Gagal memuat pembelian' }; }
}

function addPurchase(puData, userId, role) {
  try {
    if (role === 'kasir') return { success: false, message: 'Akses ditolak' };
    const { supplier_id, item_name, qty, unit, unit_price, paid_amount, purchase_date, notes } = puData;
    if (!item_name || !purchase_date) return { success: false, message: 'Nama barang dan tanggal wajib diisi' };
    const q = parseFloat(qty) || 1;
    const price = parseFloat(unit_price) || 0;
    const totalAmt = Math.round(q * price * 100) / 100;
    const paid = Math.min(parseFloat(paid_amount) || 0, totalAmt);
    const due = Math.round((totalAmt - paid) * 100) / 100;
    const sh = getSheet(SHEETS.PURCHASES);
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const newId = getNextId(SHEETS.PURCHASES);
      const purNo = genPurchaseNo();
      const now = ts();
      sh.appendRow([newId, purNo, parseInt(supplier_id) || '', item_name.trim(), q, unit || 'pcs', price, totalAmt, paid, due, purchase_date, notes || '', due <= 0 ? 'completed' : 'pending', userId, now, now]);
      logActivity(userId, 'CREATE', 'Purchases', newId, 'Menambahkan: ' + purNo);
      return { success: true, message: 'Pembelian berhasil dibuat', data: { id: newId, purchase_no: purNo } };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('addPurchase:', e); return { success: false, message: 'Gagal membuat pembelian' }; }
}

function updatePurchase(puData, userId, role) {
  try {
    if (role === 'kasir') return { success: false, message: 'Akses ditolak' };
    const { id, supplier_id, item_name, qty, unit, unit_price, paid_amount, purchase_date, notes, status } = puData;
    if (!id) return { success: false, message: 'ID pembelian wajib diisi' };
    const r = findRowByValue(SHEETS.PURCHASES, PU.ID, parseInt(id));
    if (!r) return { success: false, message: 'Pembelian tidak ditemukan' };
    const row = r.data.slice();
    row[PU.SUPPLIER_ID] = parseInt(supplier_id) || row[PU.SUPPLIER_ID];
    if (item_name) row[PU.ITEM] = item_name.trim();
    row[PU.DATE] = purchase_date || row[PU.DATE];
    row[PU.NOTES] = notes !== undefined ? notes : row[PU.NOTES];
    const q = qty !== undefined ? (parseFloat(qty) || 1) : (parseFloat(row[PU.QTY]) || 1);
    row[PU.QTY] = q;
    row[PU.UNIT] = unit || row[PU.UNIT];
    const price = unit_price !== undefined ? (parseFloat(unit_price) || 0) : (parseFloat(row[PU.UNIT_PRICE]) || 0);
    row[PU.UNIT_PRICE] = price;
    row[PU.TOTAL] = Math.round(q * price * 100) / 100;
    row[PU.PAID] = Math.min(parseFloat(paid_amount) || parseFloat(row[PU.PAID]) || 0, row[PU.TOTAL]);
    row[PU.DUE] = Math.round((row[PU.TOTAL] - row[PU.PAID]) * 100) / 100;
    row[PU.STATUS] = status || (row[PU.DUE] <= 0 ? 'completed' : 'pending');
    row[PU.UPDATED] = ts();
    getSheet(SHEETS.PURCHASES).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'UPDATE', 'Purchases', parseInt(id), 'Memperbarui: ' + row[PU.NO]);
    return { success: true, message: 'Pembelian berhasil diperbarui' };
  } catch (e) { console.error('updatePurchase:', e); return { success: false, message: 'Gagal memperbarui pembelian' }; }
}

function deletePurchase(id, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa menghapus' };
    const r = findRowByValue(SHEETS.PURCHASES, PU.ID, parseInt(id));
    if (!r) return { success: false, message: 'Pembelian tidak ditemukan' };
    const purNo = r.data[PU.NO];
    getSheet(SHEETS.PURCHASES).deleteRow(r.row);
    logActivity(userId, 'DELETE', 'Purchases', parseInt(id), 'Menghapus: ' + purNo);
    return { success: true, message: 'Pembelian berhasil dihapus' };
  } catch (e) { console.error('deletePurchase:', e); return { success: false, message: 'Gagal menghapus' }; }
}

function getPurchaseDetail(id, userId, role) {
  try {
    if (role === 'kasir') return { success: false, message: 'Akses ditolak' };
    const r = findRowByValue(SHEETS.PURCHASES, PU.ID, parseInt(id));
    if (!r) return { success: false, message: 'Tidak ditemukan' };
    const p = r.data;
    const spName = p[PU.SUPPLIER_ID] ? (findRowByValue(SHEETS.SUPPLIERS, SP.ID, parseInt(p[PU.SUPPLIER_ID]))?.data[SP.NAME] || 'Tidak diketahui') : '—';
    let payments = [];
    try {
      const pyData = getSheetData(SHEETS.PAYMENTS);
      const uData = getSheetData(SHEETS.USERS);
      const uMap = {}; uData.forEach(u => { uMap[u[U.ID]] = u[U.NAME]; });
      payments = pyData.filter(py => py[PAY.PUR_ID] == parseInt(id) && py[PAY.TYPE] === 'supplier_payment').map(py => ({
        id: py[PAY.ID], amount: parseFloat(py[PAY.AMT]) || 0, method: py[PAY.METHOD] || '',
        reference: py[PAY.REF] || '',
        date: py[PAY.DATE] instanceof Date ? py[PAY.DATE].toISOString().split('T')[0] : (py[PAY.DATE] || ''),
        notes: py[PAY.NOTES] || '', created_by_name: uMap[py[PAY.CREATED_BY]] || 'Tidak diketahui'
      }));
    } catch(e) {}
    return { success: true, data: {
      id: p[PU.ID], purchase_no: p[PU.NO], supplier_name: spName, supplier_id: p[PU.SUPPLIER_ID],
      item_name: p[PU.ITEM] || '', qty: parseFloat(p[PU.QTY]) || 0, unit: p[PU.UNIT] || '',
      unit_price: parseFloat(p[PU.UNIT_PRICE]) || 0, total_amount: parseFloat(p[PU.TOTAL]) || 0,
      paid_amount: parseFloat(p[PU.PAID]) || 0, due_amount: parseFloat(p[PU.DUE]) || 0,
      purchase_date: p[PU.DATE] instanceof Date ? p[PU.DATE].toISOString().split('T')[0] : (p[PU.DATE] || ''),
      notes: p[PU.NOTES] || '', status: p[PU.STATUS] || 'pending', payments
    }};
  } catch (e) { console.error('getPurchaseDetail:', e); return { success: false, message: 'Gagal memuat detail' }; }
}

function addPayment(payData, userId, role) {
  try {
    if (role === 'kasir') return { success: false, message: 'Akses ditolak' };
    const { purchase_id, amount, payment_method, reference_no, payment_date, notes } = payData;
    if (!purchase_id || !amount || parseFloat(amount) <= 0) return { success: false, message: 'Jumlah wajib diisi' };
    const pr = findRowByValue(SHEETS.PURCHASES, PU.ID, parseInt(purchase_id));
    if (!pr) return { success: false, message: 'Pembelian tidak ditemukan' };
    const sh = getSheet(SHEETS.PAYMENTS);
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const newId = getNextId(SHEETS.PAYMENTS);
      sh.appendRow([newId, '', parseInt(purchase_id), 'supplier_payment', parseFloat(amount), payment_method || 'tunai', reference_no || '', payment_date || ts().split('T')[0], notes || '', userId, ts()]);
      const pRow = pr.data.slice();
      pRow[PU.PAID] = (parseFloat(pRow[PU.PAID]) || 0) + parseFloat(amount);
      pRow[PU.DUE] = Math.round(((parseFloat(pRow[PU.TOTAL]) || 0) - pRow[PU.PAID]) * 100) / 100;
      if (pRow[PU.DUE] <= 0) { pRow[PU.DUE] = 0; pRow[PU.STATUS] = 'completed'; }
      pRow[PU.UPDATED] = ts();
      getSheet(SHEETS.PURCHASES).getRange(pr.row, 1, 1, pRow.length).setValues([pRow]);
      logActivity(userId, 'CREATE', 'Payments', newId, 'Pembayaran supplier ' + parseFloat(amount) + ' untuk ' + pRow[PU.NO]);
      return { success: true, message: 'Pembayaran berhasil dicatat' };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('addPayment:', e); return { success: false, message: 'Gagal mencatat pembayaran' }; }
}

function getSuppliersForDropdown() {
  try {
    const data = getSheetData(SHEETS.SUPPLIERS);
    return { success: true, data: data.filter(r => isActive(r[SP.ACTIVE])).map(r => ({ id: r[SP.ID], name: r[SP.NAME] })) };
  } catch(e) { return { success: true, data: [] }; }
}

function getMenuItems(userId, role) {
  try {
    const data = getSheetData(SHEETS.MENU_ITEMS);
    const catData = getSheetData(SHEETS.CATEGORIES);
    const catMap = {}; catData.forEach(r => { catMap[r[C.ID]] = r[C.NAME]; });
    const items = data.map(r => ({
      id: r[MI.ID], category_id: r[MI.CAT_ID], category_name: catMap[r[MI.CAT_ID]] || 'Tidak diketahui',
      name: r[MI.NAME], description: r[MI.DESC] || '', price: parseFloat(r[MI.PRICE]) || 0,
      cost: parseFloat(r[MI.COST]) || 0, track_stock: isActive(r[MI.TRACK_STOCK]) ? 1 : 0,
      stock_qty: parseInt(r[MI.STOCK_QTY]) || 0, is_available: isActive(r[MI.AVAILABLE]) ? 1 : 0,
      notes: r[MI.NOTES] || '', image: r[MI.IMG] || '',
      created_at: r[MI.CREATED] instanceof Date ? r[MI.CREATED].toISOString() : r[MI.CREATED]
    }));
    return { success: true, data: items.reverse() };
  } catch (e) { console.error('getMenuItems:', e); return { success: false, message: 'Gagal memuat menu' }; }
}

function addMenuItem(miData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { category_id, name, description, price, cost, track_stock, stock_qty, notes, imageData } = miData;
    if (!category_id || !name || price === undefined || price === '') return { success: false, message: 'Kategori, nama, dan harga wajib diisi' };
    let imgId = '';
    if (imageData && imageData.data) imgId = uploadToDrive(imageData.data, imageData.name, imageData.type, 'RestoPOS_Menu');
    const sh = getSheet(SHEETS.MENU_ITEMS);
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const newId = getNextId(SHEETS.MENU_ITEMS); const now = ts();
      const trackStock = (track_stock == 1 || track_stock === true) ? 1 : 0;
      sh.appendRow([newId, parseInt(category_id), name.trim(), description || '', parseFloat(price) || 0, parseFloat(cost) || 0, trackStock, parseInt(stock_qty) || 0, 1, notes || '', userId, now, now, imgId]);
      logActivity(userId, 'CREATE', 'Menu_Items', newId, 'Menambahkan: ' + name.trim());
      return { success: true, message: 'Menu berhasil ditambahkan', data: { id: newId } };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('addMenuItem:', e); return { success: false, message: 'Gagal menambahkan menu' }; }
}

function updateMenuItem(miData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { id, category_id, name, description, price, cost, track_stock, stock_qty, is_available, notes, imageData, removeImage } = miData;
    if (!id) return { success: false, message: 'ID wajib diisi' };
    const r = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(id));
    if (!r) return { success: false, message: 'Menu tidak ditemukan' };
    const row = r.data.slice();
    if (category_id) row[MI.CAT_ID] = parseInt(category_id);
    if (name) row[MI.NAME] = name.trim();
    row[MI.DESC] = description !== undefined ? description : row[MI.DESC];
    if (price !== undefined && price !== '') row[MI.PRICE] = parseFloat(price) || 0;
    if (cost !== undefined) row[MI.COST] = parseFloat(cost) || 0;
    row[MI.TRACK_STOCK] = (track_stock == 1 || track_stock === true) ? 1 : 0;
    if (stock_qty !== undefined) row[MI.STOCK_QTY] = parseInt(stock_qty) || 0;
    if (is_available !== undefined) row[MI.AVAILABLE] = (is_available == 1 || is_available === true) ? 1 : 0;
    row[MI.NOTES] = notes !== undefined ? notes : row[MI.NOTES];
    if (imageData && imageData.data) { if (row[MI.IMG]) deleteFromDrive(row[MI.IMG]); row[MI.IMG] = uploadToDrive(imageData.data, imageData.name, imageData.type, 'RestoPOS_Menu'); }
    else if (removeImage) { if (row[MI.IMG]) deleteFromDrive(row[MI.IMG]); row[MI.IMG] = ''; }
    row[MI.UPDATED] = ts();
    getSheet(SHEETS.MENU_ITEMS).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'UPDATE', 'Menu_Items', parseInt(id), 'Memperbarui: ' + row[MI.NAME]);
    return { success: true, message: 'Menu berhasil diperbarui' };
  } catch (e) { console.error('updateMenuItem:', e); return { success: false, message: 'Gagal memperbarui menu' }; }
}

function toggleMenuAvailability(id, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager' && role !== 'kasir') return { success: false, message: 'Akses ditolak' };
    const r = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(id));
    if (!r) return { success: false, message: 'Menu tidak ditemukan' };
    const row = r.data.slice();
    const was = isActive(row[MI.AVAILABLE]);
    row[MI.AVAILABLE] = was ? 0 : 1; row[MI.UPDATED] = ts();
    getSheet(SHEETS.MENU_ITEMS).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'TOGGLE_STATUS', 'Menu_Items', parseInt(id), (was ? 'Menu habis/nonaktif' : 'Menu tersedia') + ': ' + r.data[MI.NAME]);
    return { success: true, message: 'Status menu diperbarui', data: { is_available: was ? 0 : 1 } };
  } catch (e) { return { success: false, message: 'Gagal mengubah status' }; }
}

function deleteMenuItem(id, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa menghapus' };
    const r = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(id));
    if (!r) return { success: false, message: 'Menu tidak ditemukan' };
    const siData = getSheetData(SHEETS.SALE_ITEMS);
    if (siData.some(si => si[SI.MI_ID] == parseInt(id))) return { success: false, message: 'Tidak bisa dihapus — sudah pernah terjual. Nonaktifkan saja.' };
    const name = r.data[MI.NAME];
    if (r.data[MI.IMG]) deleteFromDrive(r.data[MI.IMG]);
    getSheet(SHEETS.MENU_ITEMS).deleteRow(r.row);
    logActivity(userId, 'DELETE', 'Menu_Items', parseInt(id), 'Menghapus: ' + name);
    return { success: true, message: 'Menu berhasil dihapus' };
  } catch (e) { console.error('deleteMenuItem:', e); return { success: false, message: 'Gagal menghapus menu' }; }
}

function checkMenuName(name, excludeId) {
  try {
    if (!name) return { success: true, exists: false };
    const data = getSheetData(SHEETS.MENU_ITEMS);
    const exists = data.some(r => String(r[MI.NAME]).trim().toLowerCase() === name.trim().toLowerCase() && (!excludeId || r[MI.ID] != parseInt(excludeId)));
    return { success: true, exists };
  } catch(e) { return { success: true, exists: false }; }
}

function getAvailableMenu(catId) {
  try {
    const data = getSheetData(SHEETS.MENU_ITEMS);
    let results = data.filter(r => isActive(r[MI.AVAILABLE]) && (!isActive(r[MI.TRACK_STOCK]) || (parseInt(r[MI.STOCK_QTY]) || 0) > 0));
    if (catId) results = results.filter(r => r[MI.CAT_ID] == parseInt(catId));
    const catData = getSheetData(SHEETS.CATEGORIES);
    const catMap = {}; catData.forEach(r => { catMap[r[C.ID]] = r[C.NAME]; });
    return { success: true, data: results.map(r => ({
      id: r[MI.ID], name: r[MI.NAME], category_id: r[MI.CAT_ID], category_name: catMap[r[MI.CAT_ID]] || '',
      price: parseFloat(r[MI.PRICE]) || 0, track_stock: isActive(r[MI.TRACK_STOCK]) ? 1 : 0,
      stock_qty: parseInt(r[MI.STOCK_QTY]) || 0, image: r[MI.IMG] || ''
    }))};
  } catch(e) { return { success: true, data: [] }; }
}

function searchMenu(query) {
  try {
    const data = getSheetData(SHEETS.MENU_ITEMS);
    const q = String(query).trim().toLowerCase();
    const results = data.filter(r => isActive(r[MI.AVAILABLE]) && String(r[MI.NAME]).toLowerCase().includes(q));
    const catData = getSheetData(SHEETS.CATEGORIES);
    const catMap = {}; catData.forEach(r => { catMap[r[C.ID]] = r[C.NAME]; });
    return { success: true, data: results.slice(0, 20).map(r => ({
      id: r[MI.ID], name: r[MI.NAME], category_name: catMap[r[MI.CAT_ID]] || '',
      price: parseFloat(r[MI.PRICE]) || 0, track_stock: isActive(r[MI.TRACK_STOCK]) ? 1 : 0,
      stock_qty: parseInt(r[MI.STOCK_QTY]) || 0, image: r[MI.IMG] || ''
    }))};
  } catch(e) { return { success: true, data: [] }; }
}

function bulkImportMenu(items, catId, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    if (!items || !items.length || !catId) return { success: false, message: 'Tidak ada data atau kategori belum dipilih' };
    const sh = getSheet(SHEETS.MENU_ITEMS);
    const existing = getSheetData(SHEETS.MENU_ITEMS);
    const existingNames = new Set(existing.map(r => String(r[MI.NAME]).trim().toLowerCase()));
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    let success = 0, failed = 0, errors = [];
    try {
      let nextId = getNextId(SHEETS.MENU_ITEMS); const now = ts(); const rows = [];
      items.forEach((item, idx) => {
        const name = String(item.name || '').trim();
        const price = parseFloat(item.price);
        const stock = parseInt(item.stock) || 0;
        if (!name) { failed++; errors.push({ row: idx+1, name, reason: 'Nama kosong' }); return; }
        if (existingNames.has(name.toLowerCase())) { failed++; errors.push({ row: idx+1, name, reason: 'Nama sudah ada' }); return; }
        if (!price || price <= 0) { failed++; errors.push({ row: idx+1, name, reason: 'Harga tidak valid' }); return; }
        rows.push([nextId++, parseInt(catId), name, '', price, 0, stock > 0 ? 1 : 0, stock, 1, '', userId, now, now, '']);
        existingNames.add(name.toLowerCase());
        success++;
      });
      if (rows.length > 0) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 14).setValues(rows);
      logActivity(userId, 'BULK_IMPORT', 'Menu_Items', '', success + ' diimpor, ' + failed + ' gagal');
      try {
        const ilSh = getSheet(SHEETS.IMPORT_LOGS);
        const ilId = getNextId(SHEETS.IMPORT_LOGS);
        ilSh.appendRow([ilId, 'import_menu.csv', parseInt(catId), items.length, success, failed, 'completed', JSON.stringify(errors.slice(0, 50)), userId, ts()]);
      } catch(e) {}
    } finally { lock.releaseLock(); }
    return { success: true, message: success + ' diimpor, ' + failed + ' gagal', data: { success, failed, errors } };
  } catch(e) { console.error('bulkImportMenu:', e); return { success: false, message: 'Impor gagal' }; }
}

function getMenuItemDetail(id) {
  try {
    const r = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(id));
    if (!r) return { success: false, message: 'Tidak ditemukan' };
    const m = r.data;
    const catName = findRowByValue(SHEETS.CATEGORIES, C.ID, parseInt(m[MI.CAT_ID]))?.data[C.NAME] || 'Tidak diketahui';
    return { success: true, data: {
      id: m[MI.ID], name: m[MI.NAME], category_name: catName, category_id: m[MI.CAT_ID],
      description: m[MI.DESC] || '', price: parseFloat(m[MI.PRICE]) || 0, cost: parseFloat(m[MI.COST]) || 0,
      track_stock: isActive(m[MI.TRACK_STOCK]) ? 1 : 0, stock_qty: parseInt(m[MI.STOCK_QTY]) || 0,
      is_available: isActive(m[MI.AVAILABLE]) ? 1 : 0, notes: m[MI.NOTES] || '', image: m[MI.IMG] || '',
      created_at: m[MI.CREATED] instanceof Date ? m[MI.CREATED].toISOString() : m[MI.CREATED]
    }};
  } catch(e) { return { success: false, message: 'Gagal' }; }
}

function updateMenuStock(id, newStock, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const r = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(id));
    if (!r) return { success: false, message: 'Tidak ditemukan' };
    const row = r.data.slice();
    row[MI.STOCK_QTY] = Math.max(0, parseInt(newStock) || 0);
    row[MI.UPDATED] = ts();
    getSheet(SHEETS.MENU_ITEMS).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'UPDATE', 'Menu_Items', parseInt(id), 'Stok diubah menjadi: ' + row[MI.STOCK_QTY]);
    return { success: true, message: 'Stok berhasil diperbarui' };
  } catch(e) { return { success: false, message: 'Gagal memperbarui stok' }; }
}

function getCustomers(userId, role) {
  try {
    const data = getSheetData(SHEETS.CUSTOMERS);
    const uData = getSheetData(SHEETS.USERS);
    const uMap = {}; uData.forEach(r => { uMap[r[U.ID]] = r[U.NAME]; });
    const custs = data.map(r => ({
      id: r[CU.ID], name: r[CU.NAME], phone: r[CU.PHONE] || '', address: r[CU.ADDR] || '',
      total_purchase: parseFloat(r[CU.TOTAL]) || 0, total_paid: parseFloat(r[CU.PAID]) || 0,
      total_due: parseFloat(r[CU.DUE]) || 0, is_active: isActive(r[CU.ACTIVE]) ? 1 : 0,
      created_by_name: uMap[r[CU.CREATED_BY]] || 'Tidak diketahui',
      created_at: r[CU.CREATED] instanceof Date ? r[CU.CREATED].toISOString() : r[CU.CREATED]
    }));
    return { success: true, data: custs.reverse() };
  } catch (e) { console.error('getCustomers:', e); return { success: false, message: 'Gagal memuat pelanggan' }; }
}

function addCustomer(cuData, userId, role) {
  try {
    const { name, phone, address } = cuData;
    if (!name) return { success: false, message: 'Nama wajib diisi' };
    const sh = getSheet(SHEETS.CUSTOMERS);
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const newId = getNextId(SHEETS.CUSTOMERS);
      sh.appendRow([newId, name.trim(), phone || '', address || '', 0, 0, 0, 1, userId, ts()]);
      logActivity(userId, 'CREATE', 'Customers', newId, 'Menambahkan: ' + name.trim());
      return { success: true, message: 'Pelanggan berhasil ditambahkan', data: { id: newId, name: name.trim() } };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('addCustomer:', e); return { success: false, message: 'Gagal menambahkan pelanggan' }; }
}

function updateCustomer(cuData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { id, name, phone, address, is_active } = cuData;
    if (!id || !name) return { success: false, message: 'Nama wajib diisi' };
    const r = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(id));
    if (!r) return { success: false, message: 'Pelanggan tidak ditemukan' };
    const row = r.data.slice();
    row[CU.NAME] = name.trim(); row[CU.PHONE] = phone || ''; row[CU.ADDR] = address || '';
    row[CU.ACTIVE] = (is_active == 1 || is_active === true) ? 1 : 0;
    getSheet(SHEETS.CUSTOMERS).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'UPDATE', 'Customers', parseInt(id), 'Memperbarui: ' + name.trim());
    return { success: true, message: 'Pelanggan berhasil diperbarui' };
  } catch (e) { console.error('updateCustomer:', e); return { success: false, message: 'Gagal memperbarui' }; }
}

function deleteCustomer(id, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa menghapus' };
    const r = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(id));
    if (!r) return { success: false, message: 'Tidak ditemukan' };
    try {
      const slData = getSheetData(SHEETS.SALES);
      if (slData.some(s => s[SL.CUST_ID] == parseInt(id))) return { success: false, message: 'Tidak bisa dihapus — masih ada transaksi terkait' };
    } catch(e) {}
    const name = r.data[CU.NAME];
    getSheet(SHEETS.CUSTOMERS).deleteRow(r.row);
    logActivity(userId, 'DELETE', 'Customers', parseInt(id), 'Menghapus: ' + name);
    return { success: true, message: 'Pelanggan berhasil dihapus' };
  } catch (e) { return { success: false, message: 'Gagal menghapus' }; }
}

function toggleCustomerStatus(id, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const r = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(id));
    if (!r) return { success: false, message: 'Tidak ditemukan' };
    const row = r.data.slice();
    const was = isActive(row[CU.ACTIVE]);
    row[CU.ACTIVE] = was ? 0 : 1;
    getSheet(SHEETS.CUSTOMERS).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'TOGGLE_STATUS', 'Customers', parseInt(id), (was ? 'Dinonaktifkan' : 'Diaktifkan') + ': ' + r.data[CU.NAME]);
    return { success: true, message: 'Pelanggan ' + (was ? 'dinonaktifkan' : 'diaktifkan') };
  } catch (e) { return { success: false, message: 'Gagal' }; }
}

function getCustomerLedger(custId, userId, role) {
  try {
    const cr = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(custId));
    if (!cr) return { success: false, message: 'Pelanggan tidak ditemukan' };
    const customer = {
      id: cr.data[CU.ID], name: cr.data[CU.NAME], phone: cr.data[CU.PHONE] || '', address: cr.data[CU.ADDR] || '',
      total_purchase: parseFloat(cr.data[CU.TOTAL]) || 0, total_paid: parseFloat(cr.data[CU.PAID]) || 0, total_due: parseFloat(cr.data[CU.DUE]) || 0
    };
    let invoices = [];
    try {
      const slData = getSheetData(SHEETS.SALES);
      invoices = slData.filter(s => s[SL.CUST_ID] == parseInt(custId)).map(s => ({
        id: s[SL.ID], invoice_no: s[SL.INV_NO],
        date: s[SL.DATE] instanceof Date ? s[SL.DATE].toISOString().split('T')[0] : (s[SL.DATE] || ''),
        total: parseFloat(s[SL.TOTAL]) || 0, paid: parseFloat(s[SL.PAID]) || 0,
        due: parseFloat(s[SL.DUE]) || 0, status: s[SL.STATUS] || 'pending'
      })).reverse();
    } catch(e) {}
    let payments = [];
    try {
      const pyData = getSheetData(SHEETS.PAYMENTS);
      const uData = getSheetData(SHEETS.USERS);
      const uMap = {}; uData.forEach(u => { uMap[u[U.ID]] = u[U.NAME]; });
      const custSaleIds = new Set(invoices.map(i => i.id));
      payments = pyData.filter(p => p[PAY.TYPE] === 'customer_payment' && (custSaleIds.has(p[PAY.SALE_ID]) || p[PAY.PUR_ID] == parseInt(custId))).map(p => ({
        id: p[PAY.ID], sale_id: p[PAY.SALE_ID] || '', amount: parseFloat(p[PAY.AMT]) || 0,
        method: p[PAY.METHOD] || '', reference: p[PAY.REF] || '',
        date: p[PAY.DATE] instanceof Date ? p[PAY.DATE].toISOString().split('T')[0] : (p[PAY.DATE] || ''),
        notes: p[PAY.NOTES] || '', created_by_name: uMap[p[PAY.CREATED_BY]] || 'Tidak diketahui'
      })).reverse();
    } catch(e) {}
    return { success: true, data: { customer, invoices, payments } };
  } catch (e) { console.error('getCustomerLedger:', e); return { success: false, message: 'Gagal memuat kartu piutang' }; }
}

function addCustomerPayment(payData, userId, role) {
  try {
    const { customer_id, sale_id, amount, method, reference, payment_date, notes } = payData;
    if (!customer_id || !amount || parseFloat(amount) <= 0) return { success: false, message: 'Jumlah wajib diisi' };
    const cr = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(customer_id));
    if (!cr) return { success: false, message: 'Pelanggan tidak ditemukan' };
    const sh = getSheet(SHEETS.PAYMENTS);
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const newId = getNextId(SHEETS.PAYMENTS);
      sh.appendRow([newId, sale_id ? parseInt(sale_id) : '', parseInt(customer_id), 'customer_payment', parseFloat(amount), method || 'Tunai', reference || '', payment_date || ts().split('T')[0], notes || '', userId, ts()]);
      const crow = cr.data.slice();
      crow[CU.PAID] = (parseFloat(crow[CU.PAID]) || 0) + parseFloat(amount);
      crow[CU.DUE] = Math.round(((parseFloat(crow[CU.TOTAL]) || 0) - crow[CU.PAID]) * 100) / 100;
      if (crow[CU.DUE] < 0) crow[CU.DUE] = 0;
      getSheet(SHEETS.CUSTOMERS).getRange(cr.row, 1, 1, crow.length).setValues([crow]);
      if (sale_id) {
        try {
          const sr = findRowByValue(SHEETS.SALES, SL.ID, parseInt(sale_id));
          if (sr) {
            const srow = sr.data.slice();
            srow[SL.PAID] = (parseFloat(srow[SL.PAID]) || 0) + parseFloat(amount);
            srow[SL.DUE] = Math.round(((parseFloat(srow[SL.TOTAL]) || 0) - srow[SL.PAID]) * 100) / 100;
            if (srow[SL.DUE] <= 0) { srow[SL.DUE] = 0; srow[SL.STATUS] = 'completed'; }
            getSheet(SHEETS.SALES).getRange(sr.row, 1, 1, srow.length).setValues([srow]);
          }
        } catch(e) {}
      }
      logActivity(userId, 'CREATE', 'Payments', newId, 'Pembayaran pelanggan ' + parseFloat(amount) + ' dari ' + cr.data[CU.NAME]);
      return { success: true, message: 'Pembayaran berhasil dicatat' };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('addCustomerPayment:', e); return { success: false, message: 'Gagal mencatat pembayaran' }; }
}

function getPayments(userId, role) {
  try {
    if (role === 'kasir') return { success: false, message: 'Akses ditolak' };
    const data = getSheetData(SHEETS.PAYMENTS);
    const cuData = getSheetData(SHEETS.CUSTOMERS);
    const cuMap = {}; cuData.forEach(r => { cuMap[r[CU.ID]] = r[CU.NAME]; });
    const spData = getSheetData(SHEETS.SUPPLIERS);
    const spMap = {}; spData.forEach(r => { spMap[r[SP.ID]] = r[SP.NAME]; });
    const uData = getSheetData(SHEETS.USERS);
    const uMap = {}; uData.forEach(r => { uMap[r[U.ID]] = r[U.NAME]; });
    const slData = getSheetData(SHEETS.SALES);
    const saleCustMap = {}; slData.forEach(r => { saleCustMap[r[SL.ID]] = { inv: r[SL.INV_NO], cust: r[SL.CUST_ID] ? (cuMap[r[SL.CUST_ID]] || 'Umum') : 'Umum' }; });
    const puData = getSheetData(SHEETS.PURCHASES);
    const purSuppMap = {}; puData.forEach(r => { purSuppMap[r[PU.ID]] = { no: r[PU.NO], supp: spMap[r[PU.SUPPLIER_ID]] || 'Tidak diketahui' }; });
    const payments = data.map(r => {
      const isCust = r[PAY.TYPE] === 'customer_payment';
      const saleInfo = r[PAY.SALE_ID] ? saleCustMap[r[PAY.SALE_ID]] : null;
      const purInfo = !isCust && r[PAY.PUR_ID] ? purSuppMap[r[PAY.PUR_ID]] : null;
      return {
        id: r[PAY.ID], payment_type: r[PAY.TYPE],
        ref_no: isCust ? (saleInfo?.inv || '') : (purInfo?.no || ''),
        party_name: isCust ? (saleInfo?.cust || cuMap[r[PAY.PUR_ID]] || 'Umum') : (purInfo?.supp || 'Tidak diketahui'),
        amount: parseFloat(r[PAY.AMT]) || 0, method: r[PAY.METHOD] || '', reference: r[PAY.REF] || '',
        date: r[PAY.DATE] instanceof Date ? r[PAY.DATE].toISOString().split('T')[0] : (r[PAY.DATE] || ''),
        notes: r[PAY.NOTES] || '', created_by_name: uMap[r[PAY.CREATED_BY]] || 'Tidak diketahui'
      };
    });
    return { success: true, data: payments.reverse() };
  } catch (e) { console.error('getPayments:', e); return { success: false, message: 'Gagal memuat pembayaran' }; }
}

function getCustomersForDropdown() {
  try {
    const data = getSheetData(SHEETS.CUSTOMERS);
    return { success: true, data: data.filter(r => isActive(r[CU.ACTIVE])).map(r => ({ id: r[CU.ID], name: r[CU.NAME] })) };
  } catch(e) { return { success: true, data: [] }; }
}

function genInvoiceNo() {
  const d = new Date();
  const dt = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const data = getSheetData(SHEETS.SALES);
  const today = data.filter(r => String(r[SL.INV_NO]).includes(dt));
  const maxSeq = today.reduce((m, r) => { const parts = String(r[SL.INV_NO]).split('-'); return Math.max(m, parseInt(parts[parts.length-1]) || 0); }, 0);
  const prefix = (getSettings().data || {}).invoice_prefix || 'STRK';
  return prefix + '-' + dt + '-' + String(maxSeq + 1).padStart(3, '0');
}

function completeSale(saleData, userId, role) {
  try {
    const { customer_id, items, discount, paid_amount, payment_method, payment_reference, notes, status, order_type, table_no } = saleData;
    if (!items || !items.length) return { success: false, message: 'Tambahkan item ke keranjang' };
    const totalItems = items.reduce((s, i) => s + (parseInt(i.qty) || 1), 0);
    const subtotal = items.reduce((s, i) => s + (parseFloat(i.line_total) || 0), 0);
    const disc = parseFloat(discount) || 0;
    const grandTotal = Math.round((subtotal - disc) * 100) / 100;
    const paid = Math.min(parseFloat(paid_amount) || 0, grandTotal);
    const due = Math.round((grandTotal - paid) * 100) / 100;
    const saleStatus = status || (due <= 0 ? 'completed' : 'pending');

    const sh = getSheet(SHEETS.SALES);
    const siSh = getSheet(SHEETS.SALE_ITEMS);
    const miSh = getSheet(SHEETS.MENU_ITEMS);
    const lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      const saleId = getNextId(SHEETS.SALES);
      const invNo = genInvoiceNo();
      const now = ts();
      sh.appendRow([saleId, invNo, customer_id ? parseInt(customer_id) : '', order_type || 'dine_in', table_no || '', totalItems, Math.round(subtotal*100)/100, disc, grandTotal, paid, due, payment_method || 'tunai', now, saleStatus, notes || '', userId, now, now]);

      let siId = getNextId(SHEETS.SALE_ITEMS);
      const siRows = []; const stockUpdates = [];
      items.forEach(item => {
        const qty = parseInt(item.qty) || 1;
        siRows.push([siId++, saleId, parseInt(item.menu_item_id), item.name, qty, parseFloat(item.price), parseFloat(item.line_total), item.notes || '']);
        const mr = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(item.menu_item_id));
        if (mr && isActive(mr.data[MI.TRACK_STOCK])) {
          const mrow = mr.data.slice();
          mrow[MI.STOCK_QTY] = Math.max(0, (parseInt(mrow[MI.STOCK_QTY]) || 0) - qty);
          mrow[MI.UPDATED] = now;
          stockUpdates.push({ row: mr.row, data: mrow });
        }
      });
      if (siRows.length) siSh.getRange(siSh.getLastRow() + 1, 1, siRows.length, 8).setValues(siRows);
      stockUpdates.forEach(u => miSh.getRange(u.row, 1, 1, u.data.length).setValues([u.data]));

      if (customer_id) {
        const cr = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(customer_id));
        if (cr) {
          const crow = cr.data.slice();
          crow[CU.TOTAL] = (parseFloat(crow[CU.TOTAL]) || 0) + grandTotal;
          crow[CU.PAID] = (parseFloat(crow[CU.PAID]) || 0) + paid;
          crow[CU.DUE] = Math.round(((parseFloat(crow[CU.TOTAL])) - (parseFloat(crow[CU.PAID]))) * 100) / 100;
          getSheet(SHEETS.CUSTOMERS).getRange(cr.row, 1, 1, crow.length).setValues([crow]);
        }
      }

      if (paid > 0) {
        const pyId = getNextId(SHEETS.PAYMENTS);
        getSheet(SHEETS.PAYMENTS).appendRow([pyId, saleId, customer_id ? parseInt(customer_id) : '', 'customer_payment', paid, payment_method || 'tunai', payment_reference || '', now.split('T')[0], '', userId, now]);
      }

      logActivity(userId, 'CREATE', 'Sales', saleId, invNo + ' Rp' + grandTotal);
      return { success: true, message: 'Transaksi berhasil', data: { id: saleId, invoice_no: invNo } };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('completeSale:', e); return { success: false, message: 'Gagal menyelesaikan transaksi' }; }
}

function getSales(userId, role) {
  try {
    const data = getSheetData(SHEETS.SALES);
    const cuData = getSheetData(SHEETS.CUSTOMERS);
    const uData = getSheetData(SHEETS.USERS);
    const cuMap = {}; cuData.forEach(r => { cuMap[r[CU.ID]] = r[CU.NAME]; });
    const uMap = {}; uData.forEach(r => { uMap[r[U.ID]] = r[U.NAME]; });
    let sales = data.map(r => ({
      id: r[SL.ID], invoice_no: r[SL.INV_NO],
      customer_id: r[SL.CUST_ID], customer_name: r[SL.CUST_ID] ? (cuMap[r[SL.CUST_ID]] || 'Tidak diketahui') : 'Pelanggan Umum',
      order_type: r[SL.ORDER_TYPE] || 'dine_in', table_no: r[SL.TABLE_NO] || '',
      total_items: parseInt(r[SL.ITEMS]) || 0, grand_total: parseFloat(r[SL.TOTAL]) || 0,
      paid_amount: parseFloat(r[SL.PAID]) || 0, due_amount: parseFloat(r[SL.DUE]) || 0,
      payment_method: r[SL.METHOD] || 'tunai',
      sale_date: r[SL.DATE] instanceof Date ? r[SL.DATE].toISOString() : r[SL.DATE],
      status: r[SL.STATUS] || 'completed', created_by: r[SL.CREATED_BY],
      cashier_name: uMap[r[SL.CREATED_BY]] || 'Tidak diketahui',
      created_at: r[SL.CREATED] instanceof Date ? r[SL.CREATED].toISOString() : r[SL.CREATED]
    }));
    if (role === 'kasir') sales = sales.filter(s => s.created_by == userId);
    return { success: true, data: sales.reverse() };
  } catch (e) { console.error('getSales:', e); return { success: false, message: 'Gagal memuat transaksi' }; }
}

function getSaleDetail(id, userId, role) {
  try {
    const r = findRowByValue(SHEETS.SALES, SL.ID, parseInt(id));
    if (!r) return { success: false, message: 'Tidak ditemukan' };
    const s = r.data;
    const custName = s[SL.CUST_ID] ? (findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(s[SL.CUST_ID]))?.data[CU.NAME] || 'Tidak diketahui') : 'Pelanggan Umum';
    const siData = getSheetData(SHEETS.SALE_ITEMS);
    const items = siData.filter(si => si[SI.SALE_ID] == parseInt(id)).map(si => ({
      id: si[SI.ID], name: si[SI.NAME], qty: parseInt(si[SI.QTY]) || 1,
      price: parseFloat(si[SI.PRICE]), total: parseFloat(si[SI.TOTAL]), notes: si[SI.NOTES] || ''
    }));
    const uData = getSheetData(SHEETS.USERS);
    const uMap = {}; uData.forEach(u => { uMap[u[U.ID]] = u[U.NAME]; });
    let payments = [];
    try {
      const pyData = getSheetData(SHEETS.PAYMENTS);
      payments = pyData.filter(p => p[PAY.SALE_ID] == parseInt(id) && p[PAY.TYPE] === 'customer_payment').map(p => ({
        id: p[PAY.ID], amount: parseFloat(p[PAY.AMT]), method: p[PAY.METHOD] || '', reference: p[PAY.REF] || '',
        date: p[PAY.DATE] instanceof Date ? p[PAY.DATE].toISOString().split('T')[0] : (p[PAY.DATE] || ''),
        created_by_name: uMap[p[PAY.CREATED_BY]] || 'Tidak diketahui'
      })).reverse();
    } catch(e) {}
    return { success: true, data: {
      id: s[SL.ID], invoice_no: s[SL.INV_NO], customer_id: s[SL.CUST_ID], customer_name: custName,
      order_type: s[SL.ORDER_TYPE] || 'dine_in', table_no: s[SL.TABLE_NO] || '',
      total_items: parseInt(s[SL.ITEMS]), subtotal: parseFloat(s[SL.SUBTOTAL]) || 0, discount: parseFloat(s[SL.DISC]) || 0,
      grand_total: parseFloat(s[SL.TOTAL]), paid_amount: parseFloat(s[SL.PAID]), due_amount: parseFloat(s[SL.DUE]),
      payment_method: s[SL.METHOD], sale_date: s[SL.DATE] instanceof Date ? s[SL.DATE].toISOString() : s[SL.DATE],
      status: s[SL.STATUS], notes: s[SL.NOTES] || '', cashier_name: uMap[s[SL.CREATED_BY]] || 'Tidak diketahui',
      items, payments
    }};
  } catch (e) { console.error('getSaleDetail:', e); return { success: false, message: 'Gagal memuat transaksi' }; }
}

function cancelSale(id, reason, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const r = findRowByValue(SHEETS.SALES, SL.ID, parseInt(id));
    if (!r) return { success: false, message: 'Tidak ditemukan' };
    if (r.data[SL.STATUS] === 'cancelled') return { success: false, message: 'Sudah dibatalkan' };
    const row = r.data.slice();
    row[SL.STATUS] = 'cancelled';
    row[SL.NOTES] = (row[SL.NOTES] || '') + ' | Dibatalkan: ' + (reason || 'Tanpa alasan');
    row[SL.UPDATED] = ts();
    getSheet(SHEETS.SALES).getRange(r.row, 1, 1, row.length).setValues([row]);

    const siData = getSheetData(SHEETS.SALE_ITEMS);
    const saleItems = siData.filter(si => si[SI.SALE_ID] == parseInt(id));
    const miSh = getSheet(SHEETS.MENU_ITEMS);
    const nowTs = ts();
    saleItems.forEach(si => {
      const mr = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(si[SI.MI_ID]));
      if (mr && isActive(mr.data[MI.TRACK_STOCK])) {
        const mrow = mr.data.slice();
        mrow[MI.STOCK_QTY] = (parseInt(mrow[MI.STOCK_QTY]) || 0) + (parseInt(si[SI.QTY]) || 1);
        mrow[MI.UPDATED] = nowTs;
        miSh.getRange(mr.row, 1, 1, mrow.length).setValues([mrow]);
      }
    });

    if (row[SL.CUST_ID]) {
      const cr = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(row[SL.CUST_ID]));
      if (cr) {
        const crow = cr.data.slice();
        crow[CU.TOTAL] = Math.max(0, (parseFloat(crow[CU.TOTAL]) || 0) - (parseFloat(row[SL.TOTAL]) || 0));
        crow[CU.PAID] = Math.max(0, (parseFloat(crow[CU.PAID]) || 0) - (parseFloat(row[SL.PAID]) || 0));
        crow[CU.DUE] = Math.round((crow[CU.TOTAL] - crow[CU.PAID]) * 100) / 100;
        getSheet(SHEETS.CUSTOMERS).getRange(cr.row, 1, 1, crow.length).setValues([crow]);
      }
    }
    try {
      const pySh = getSheet(SHEETS.PAYMENTS);
      const pyData = getSheetData(SHEETS.PAYMENTS);
      pyData.forEach((py, idx) => {
        if (py[PAY.SALE_ID] == parseInt(id) && py[PAY.TYPE] === 'customer_payment') {
          const prow = py.slice();
          prow[PAY.NOTES] = '[DIBATALKAN] ' + (prow[PAY.NOTES] || '');
          pySh.getRange(idx + 2, 1, 1, prow.length).setValues([prow]);
        }
      });
    } catch(e) {}
    logActivity(userId, 'CANCEL', 'Sales', parseInt(id), 'Dibatalkan: ' + row[SL.INV_NO]);
    return { success: true, message: 'Transaksi dibatalkan, stok menu dikembalikan' };
  } catch (e) { console.error('cancelSale:', e); return { success: false, message: 'Gagal membatalkan' }; }
}

function updateSale(saleData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { id, customer_id, discount, paid_amount, payment_method, notes, status, order_type, table_no } = saleData;
    if (!id) return { success: false, message: 'ID wajib diisi' };
    const r = findRowByValue(SHEETS.SALES, SL.ID, parseInt(id));
    if (!r) return { success: false, message: 'Transaksi tidak ditemukan' };
    if (r.data[SL.STATUS] === 'cancelled') return { success: false, message: 'Tidak bisa mengubah transaksi yang dibatalkan' };
    const row = r.data.slice();
    const oldCustId = row[SL.CUST_ID];
    const oldTotal = parseFloat(row[SL.TOTAL]) || 0;
    const oldPaid = parseFloat(row[SL.PAID]) || 0;
    const newCustId = customer_id !== undefined ? (customer_id ? parseInt(customer_id) : '') : row[SL.CUST_ID];
    row[SL.CUST_ID] = newCustId;
    if (order_type) row[SL.ORDER_TYPE] = order_type;
    if (table_no !== undefined) row[SL.TABLE_NO] = table_no;
    const disc = discount !== undefined ? (parseFloat(discount) || 0) : (parseFloat(row[SL.DISC]) || 0);
    row[SL.DISC] = disc;
    const subtotal = parseFloat(row[SL.SUBTOTAL]) || 0;
    const newTotal = Math.round((subtotal - disc) * 100) / 100;
    row[SL.TOTAL] = newTotal;
    const paid = paid_amount !== undefined ? Math.min(parseFloat(paid_amount) || 0, newTotal) : Math.min(parseFloat(row[SL.PAID]) || 0, newTotal);
    row[SL.PAID] = paid;
    row[SL.DUE] = Math.round((newTotal - paid) * 100) / 100;
    if (payment_method) row[SL.METHOD] = payment_method;
    if (notes !== undefined) row[SL.NOTES] = notes;
    if (status && status !== 'cancelled') row[SL.STATUS] = status;
    else row[SL.STATUS] = row[SL.DUE] <= 0 ? 'completed' : 'pending';
    row[SL.UPDATED] = ts();
    getSheet(SHEETS.SALES).getRange(r.row, 1, 1, row.length).setValues([row]);

    if (oldCustId && oldCustId != newCustId) {
      const ocr = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(oldCustId));
      if (ocr) {
        const oc = ocr.data.slice();
        oc[CU.TOTAL] = Math.max(0, (parseFloat(oc[CU.TOTAL]) || 0) - oldTotal);
        oc[CU.PAID] = Math.max(0, (parseFloat(oc[CU.PAID]) || 0) - oldPaid);
        oc[CU.DUE] = Math.round((oc[CU.TOTAL] - oc[CU.PAID]) * 100) / 100;
        getSheet(SHEETS.CUSTOMERS).getRange(ocr.row, 1, 1, oc.length).setValues([oc]);
      }
    }
    if (newCustId) {
      const ncr = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(newCustId));
      if (ncr) {
        const nc = ncr.data.slice();
        if (oldCustId == newCustId) { nc[CU.TOTAL] = Math.max(0, (parseFloat(nc[CU.TOTAL]) || 0) + (newTotal - oldTotal)); nc[CU.PAID] = Math.max(0, (parseFloat(nc[CU.PAID]) || 0) + (paid - oldPaid)); }
        else { nc[CU.TOTAL] = (parseFloat(nc[CU.TOTAL]) || 0) + newTotal; nc[CU.PAID] = (parseFloat(nc[CU.PAID]) || 0) + paid; }
        nc[CU.DUE] = Math.round((nc[CU.TOTAL] - nc[CU.PAID]) * 100) / 100;
        getSheet(SHEETS.CUSTOMERS).getRange(ncr.row, 1, 1, nc.length).setValues([nc]);
      }
    }
    logActivity(userId, 'UPDATE', 'Sales', parseInt(id), 'Memperbarui: ' + row[SL.INV_NO]);
    return { success: true, message: 'Transaksi berhasil diperbarui' };
  } catch (e) { console.error('updateSale:', e); return { success: false, message: 'Gagal memperbarui transaksi' }; }
}

function addSaleItem(saleId, menuItemId, qty, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const sr = findRowByValue(SHEETS.SALES, SL.ID, parseInt(saleId));
    if (!sr) return { success: false, message: 'Transaksi tidak ditemukan' };
    if (sr.data[SL.STATUS] === 'cancelled') return { success: false, message: 'Tidak bisa mengubah transaksi yang dibatalkan' };
    const mr = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(menuItemId));
    if (!mr) return { success: false, message: 'Menu tidak ditemukan' };
    const m = mr.data;
    const q = parseInt(qty) || 1;
    const price = parseFloat(m[MI.PRICE]) || 0;
    const lineTotal = Math.round(price * q * 100) / 100;
    const now = ts();
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const siId = getNextId(SHEETS.SALE_ITEMS);
      getSheet(SHEETS.SALE_ITEMS).appendRow([siId, parseInt(saleId), parseInt(menuItemId), m[MI.NAME], q, price, lineTotal, '']);
      if (isActive(m[MI.TRACK_STOCK])) {
        const mrow = m.slice();
        mrow[MI.STOCK_QTY] = Math.max(0, (parseInt(mrow[MI.STOCK_QTY]) || 0) - q);
        mrow[MI.UPDATED] = now;
        getSheet(SHEETS.MENU_ITEMS).getRange(mr.row, 1, 1, mrow.length).setValues([mrow]);
      }
      recalcSaleFromItems(sr, now);
      logActivity(userId, 'UPDATE', 'Sales', parseInt(saleId), 'Menambah item: ' + m[MI.NAME]);
      return { success: true, message: 'Item ditambahkan' };
    } finally { lock.releaseLock(); }
  } catch(e) { console.error('addSaleItem:', e); return { success: false, message: 'Gagal menambahkan item' }; }
}

function removeSaleItem(saleItemId, saleId, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const sr = findRowByValue(SHEETS.SALES, SL.ID, parseInt(saleId));
    if (!sr) return { success: false, message: 'Transaksi tidak ditemukan' };
    if (sr.data[SL.STATUS] === 'cancelled') return { success: false, message: 'Tidak bisa mengubah transaksi yang dibatalkan' };
    const siData = getSheetData(SHEETS.SALE_ITEMS);
    let siRow = -1, siRecord = null;
    siData.forEach((si, idx) => { if (si[SI.ID] == parseInt(saleItemId) && si[SI.SALE_ID] == parseInt(saleId)) { siRow = idx + 2; siRecord = si; } });
    if (!siRecord) return { success: false, message: 'Item tidak ditemukan' };
    const now = ts();
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const mr = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(siRecord[SI.MI_ID]));
      if (mr && isActive(mr.data[MI.TRACK_STOCK])) {
        const mrow = mr.data.slice();
        mrow[MI.STOCK_QTY] = (parseInt(mrow[MI.STOCK_QTY]) || 0) + (parseInt(siRecord[SI.QTY]) || 1);
        mrow[MI.UPDATED] = now;
        getSheet(SHEETS.MENU_ITEMS).getRange(mr.row, 1, 1, mrow.length).setValues([mrow]);
      }
      getSheet(SHEETS.SALE_ITEMS).deleteRow(siRow);
      recalcSaleFromItems(sr, now);
      logActivity(userId, 'UPDATE', 'Sales', parseInt(saleId), 'Menghapus item: ' + siRecord[SI.NAME]);
      return { success: true, message: 'Item dihapus' };
    } finally { lock.releaseLock(); }
  } catch(e) { console.error('removeSaleItem:', e); return { success: false, message: 'Gagal menghapus item' }; }
}

function recalcSaleFromItems(sr, now) {
  const saleId = sr.data[SL.ID];
  const siData = getSheetData(SHEETS.SALE_ITEMS);
  const items = siData.filter(si => si[SI.SALE_ID] == saleId);
  let totalPcs = 0, subtotal = 0;
  items.forEach(si => { totalPcs += parseInt(si[SI.QTY]) || 1; subtotal += parseFloat(si[SI.TOTAL]) || 0; });
  const row = sr.data.slice();
  const oldTotal = parseFloat(row[SL.TOTAL]) || 0;
  const disc = parseFloat(row[SL.DISC]) || 0;
  const newTotal = Math.round((subtotal - disc) * 100) / 100;
  const paid = parseFloat(row[SL.PAID]) || 0;
  row[SL.ITEMS] = totalPcs; row[SL.SUBTOTAL] = Math.round(subtotal * 100) / 100; row[SL.TOTAL] = newTotal;
  row[SL.DUE] = Math.round(Math.max(0, newTotal - paid) * 100) / 100;
  row[SL.STATUS] = row[SL.DUE] <= 0 ? 'completed' : 'pending';
  row[SL.UPDATED] = now;
  getSheet(SHEETS.SALES).getRange(sr.row, 1, 1, row.length).setValues([row]);
  if (row[SL.CUST_ID]) {
    const diff = newTotal - oldTotal;
    if (diff !== 0) {
      const cr = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(row[SL.CUST_ID]));
      if (cr) {
        const crow = cr.data.slice();
        crow[CU.TOTAL] = Math.max(0, (parseFloat(crow[CU.TOTAL]) || 0) + diff);
        crow[CU.DUE] = Math.round((crow[CU.TOTAL] - (parseFloat(crow[CU.PAID]) || 0)) * 100) / 100;
        getSheet(SHEETS.CUSTOMERS).getRange(cr.row, 1, 1, crow.length).setValues([crow]);
      }
    }
  }
}

function deleteSale(id, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa menghapus transaksi' };
    const r = findRowByValue(SHEETS.SALES, SL.ID, parseInt(id));
    if (!r) return { success: false, message: 'Transaksi tidak ditemukan' };
    const row = r.data;
    const invNo = row[SL.INV_NO];
    const notCancelled = row[SL.STATUS] !== 'cancelled';
    const lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      if (notCancelled) {
        const siData = getSheetData(SHEETS.SALE_ITEMS);
        const saleItems = siData.filter(si => si[SI.SALE_ID] == parseInt(id));
        saleItems.forEach(si => {
          const mr = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, parseInt(si[SI.MI_ID]));
          if (mr && isActive(mr.data[MI.TRACK_STOCK])) {
            const mrow = mr.data.slice();
            mrow[MI.STOCK_QTY] = (parseInt(mrow[MI.STOCK_QTY]) || 0) + (parseInt(si[SI.QTY]) || 1);
            mrow[MI.UPDATED] = ts();
            getSheet(SHEETS.MENU_ITEMS).getRange(mr.row, 1, 1, mrow.length).setValues([mrow]);
          }
        });
      }
      if (notCancelled && row[SL.CUST_ID]) {
        const cr = findRowByValue(SHEETS.CUSTOMERS, CU.ID, parseInt(row[SL.CUST_ID]));
        if (cr) {
          const crow = cr.data.slice();
          crow[CU.TOTAL] = Math.max(0, (parseFloat(crow[CU.TOTAL]) || 0) - (parseFloat(row[SL.TOTAL]) || 0));
          crow[CU.PAID] = Math.max(0, (parseFloat(crow[CU.PAID]) || 0) - (parseFloat(row[SL.PAID]) || 0));
          crow[CU.DUE] = Math.round((crow[CU.TOTAL] - crow[CU.PAID]) * 100) / 100;
          getSheet(SHEETS.CUSTOMERS).getRange(cr.row, 1, 1, crow.length).setValues([crow]);
        }
      }
      const siSh = getSheet(SHEETS.SALE_ITEMS);
      const siAll = getSheetData(SHEETS.SALE_ITEMS);
      const siRows = [];
      siAll.forEach((si, idx) => { if (si[SI.SALE_ID] == parseInt(id)) siRows.push(idx + 2); });
      siRows.reverse().forEach(rn => siSh.deleteRow(rn));
      const pySh = getSheet(SHEETS.PAYMENTS);
      const pyAll = getSheetData(SHEETS.PAYMENTS);
      const pyRows = [];
      pyAll.forEach((py, idx) => { if (py[PAY.SALE_ID] == parseInt(id) && py[PAY.TYPE] === 'customer_payment') pyRows.push(idx + 2); });
      pyRows.reverse().forEach(rn => pySh.deleteRow(rn));
      getSheet(SHEETS.SALES).deleteRow(r.row);
      logActivity(userId, 'DELETE', 'Sales', parseInt(id), 'Menghapus: ' + invNo);
      return { success: true, message: 'Transaksi berhasil dihapus permanen' };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('deleteSale:', e); return { success: false, message: 'Gagal menghapus transaksi' }; }
}

function returnSaleItem(saleItemId, saleId, reason, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const sr = findRowByValue(SHEETS.SALES, SL.ID, parseInt(saleId));
    if (!sr) return { success: false, message: 'Transaksi tidak ditemukan' };
    if (sr.data[SL.STATUS] === 'cancelled') return { success: false, message: 'Tidak bisa retur dari transaksi yang dibatalkan' };
    const siRow = findRowByValue(SHEETS.SALE_ITEMS, SI.ID, parseInt(saleItemId));
    if (!siRow) return { success: false, message: 'Item tidak ditemukan' };
    if (siRow.data[SI.SALE_ID] != parseInt(saleId)) return { success: false, message: 'Item bukan milik transaksi ini' };
    const miId = parseInt(siRow.data[SI.MI_ID]);
    const qty = parseInt(siRow.data[SI.QTY]) || 1;
    const name = siRow.data[SI.NAME] || '';
    const lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      const now = ts();
      const mr = findRowByValue(SHEETS.MENU_ITEMS, MI.ID, miId);
      if (mr && isActive(mr.data[MI.TRACK_STOCK])) {
        const mrow = mr.data.slice();
        mrow[MI.STOCK_QTY] = (parseInt(mrow[MI.STOCK_QTY]) || 0) + qty;
        mrow[MI.UPDATED] = now;
        getSheet(SHEETS.MENU_ITEMS).getRange(mr.row, 1, 1, mrow.length).setValues([mrow]);
      }
      getSheet(SHEETS.SALE_ITEMS).deleteRow(siRow.row);
      const freshSr = findRowByValue(SHEETS.SALES, SL.ID, parseInt(saleId));
      recalcSaleFromItems(freshSr, now);
      const saleRow = findRowByValue(SHEETS.SALES, SL.ID, parseInt(saleId));
      if (saleRow) {
        const existing = saleRow.data[SL.NOTES] || '';
        getSheet(SHEETS.SALES).getRange(saleRow.row, SL.NOTES + 1).setValue(existing + ' | Retur: ' + name + ' - ' + (reason || 'tanpa alasan'));
      }
      logActivity(userId, 'RETURN_ITEM', 'Sale_Items', parseInt(saleItemId), 'Retur ' + name + ' dari transaksi #' + saleId);
      return { success: true, message: 'Item berhasil diretur' };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('returnSaleItem:', e); return { success: false, message: 'Gagal meretur item' }; }
}

function getExpenses(userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const data = getSheetData(SHEETS.EXPENSES);
    const uData = getSheetData(SHEETS.USERS);
    const uMap = {}; uData.forEach(r => { uMap[r[U.ID]] = r[U.NAME]; });
    const expenses = data.map(r => ({
      id: r[EX.ID], title: r[EX.TITLE], category: r[EX.CAT] || 'lainnya',
      amount: parseFloat(r[EX.AMT]) || 0,
      expense_date: r[EX.DATE] instanceof Date ? r[EX.DATE].toISOString().split('T')[0] : (r[EX.DATE] || ''),
      notes: r[EX.NOTES] || '', created_by_name: uMap[r[EX.CREATED_BY]] || 'Tidak diketahui',
      created_at: r[EX.CREATED] instanceof Date ? r[EX.CREATED].toISOString() : r[EX.CREATED]
    }));
    return { success: true, data: expenses.reverse() };
  } catch (e) { console.error('getExpenses:', e); return { success: false, message: 'Gagal memuat pengeluaran' }; }
}

function addExpense(exData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { title, category, amount, expense_date, notes } = exData;
    if (!title || !amount) return { success: false, message: 'Judul dan jumlah wajib diisi' };
    const sh = getSheet(SHEETS.EXPENSES);
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const newId = getNextId(SHEETS.EXPENSES);
      sh.appendRow([newId, title.trim(), category || 'lainnya', parseFloat(amount), expense_date || ts().split('T')[0], notes || '', userId, ts()]);
      logActivity(userId, 'CREATE', 'Expenses', newId, 'Rp' + parseFloat(amount) + ' - ' + title.trim());
      return { success: true, message: 'Pengeluaran berhasil ditambahkan', data: { id: newId } };
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('addExpense:', e); return { success: false, message: 'Gagal menambahkan pengeluaran' }; }
}

function updateExpense(exData, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    const { id, title, category, amount, expense_date, notes } = exData;
    if (!id || !title || !amount) return { success: false, message: 'Judul dan jumlah wajib diisi' };
    const r = findRowByValue(SHEETS.EXPENSES, EX.ID, parseInt(id));
    if (!r) return { success: false, message: 'Tidak ditemukan' };
    const row = r.data.slice();
    row[EX.TITLE] = title.trim(); row[EX.CAT] = category || 'lainnya'; row[EX.AMT] = parseFloat(amount);
    row[EX.DATE] = expense_date || row[EX.DATE]; row[EX.NOTES] = notes !== undefined ? notes : row[EX.NOTES];
    getSheet(SHEETS.EXPENSES).getRange(r.row, 1, 1, row.length).setValues([row]);
    logActivity(userId, 'UPDATE', 'Expenses', parseInt(id), 'Memperbarui: ' + title.trim());
    return { success: true, message: 'Pengeluaran berhasil diperbarui' };
  } catch (e) { console.error('updateExpense:', e); return { success: false, message: 'Gagal memperbarui' }; }
}

function deleteExpense(id, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa menghapus' };
    const r = findRowByValue(SHEETS.EXPENSES, EX.ID, parseInt(id));
    if (!r) return { success: false, message: 'Tidak ditemukan' };
    const title = r.data[EX.TITLE];
    getSheet(SHEETS.EXPENSES).deleteRow(r.row);
    logActivity(userId, 'DELETE', 'Expenses', parseInt(id), 'Menghapus: ' + title);
    return { success: true, message: 'Pengeluaran berhasil dihapus' };
  } catch (e) { return { success: false, message: 'Gagal menghapus' }; }
}

function getImportLogs(userId, role) {
  try {
    if (role === 'kasir') return { success: false, message: 'Akses ditolak' };
    const data = getSheetData(SHEETS.IMPORT_LOGS);
    const catData = getSheetData(SHEETS.CATEGORIES);
    const uData = getSheetData(SHEETS.USERS);
    const catMap = {}; catData.forEach(r => { catMap[r[C.ID]] = r[C.NAME]; });
    const uMap = {}; uData.forEach(r => { uMap[r[U.ID]] = r[U.NAME]; });
    const logs = data.map(r => ({
      id: r[IL.ID], file_name: r[IL.FILE], category_id: r[IL.CAT_ID],
      category_name: catMap[r[IL.CAT_ID]] || 'Tidak diketahui',
      total_rows: parseInt(r[IL.TOTAL]) || 0, success_rows: parseInt(r[IL.SUCCESS]) || 0,
      failed_rows: parseInt(r[IL.FAILED]) || 0, status: r[IL.STATUS] || 'completed',
      error_log: r[IL.ERRORS] || '', created_by_name: uMap[r[IL.CREATED_BY]] || 'Tidak diketahui',
      created_at: r[IL.CREATED] instanceof Date ? r[IL.CREATED].toISOString() : r[IL.CREATED]
    }));
    return { success: true, data: logs.reverse() };
  } catch (e) { console.error('getImportLogs:', e); return { success: false, message: 'Gagal memuat riwayat impor' }; }
}

function getSettings() {
  try {
    const data = getSheetData(SHEETS.SETTINGS);
    const settings = {};
    data.forEach(r => { settings[r[ST.KEY]] = r[ST.VAL]; });
    return { success: true, data: settings };
  } catch(e) { return { success: true, data: {} }; }
}

function saveSetting(key, value, userId) {
  try {
    const r = findRowByValue(SHEETS.SETTINGS, ST.KEY, key);
    if (r) {
      const row = r.data.slice();
      row[ST.VAL] = value; row[ST.UPDATED_BY] = userId; row[ST.UPDATED] = ts();
      getSheet(SHEETS.SETTINGS).getRange(r.row, 1, 1, row.length).setValues([row]);
    } else {
      const sh = getSheet(SHEETS.SETTINGS);
      sh.appendRow([getNextId(SHEETS.SETTINGS), key, value, userId, ts()]);
    }
    return { success: true, message: 'Pengaturan disimpan' };
  } catch(e) { return { success: false, message: 'Gagal menyimpan' }; }
}

function saveAllSettings(settingsObj, userId, role) {
  try {
    if (role !== 'admin') return { success: false, message: 'Hanya admin yang bisa mengubah pengaturan' };
    Object.entries(settingsObj).forEach(([key, value]) => { saveSetting(key, String(value), userId); });
    logActivity(userId, 'UPDATE', 'Settings', '', 'Pengaturan diperbarui');
    return { success: true, message: 'Pengaturan berhasil disimpan' };
  } catch(e) { return { success: false, message: 'Gagal menyimpan pengaturan' }; }
}

function getDashboardStats(userId, role) {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const slData = getSheetData(SHEETS.SALES);
    const activeSales = slData.filter(s => s[SL.STATUS] !== 'cancelled');
    const todaySales = activeSales.filter(s => { const d = s[SL.DATE] instanceof Date ? s[SL.DATE].toISOString().split('T')[0] : String(s[SL.DATE]).split('T')[0]; return d === todayStr; });

    const miData = getSheetData(SHEETS.MENU_ITEMS);
    const availMenu = miData.filter(m => isActive(m[MI.AVAILABLE]));
    const lowStockMenu = miData.filter(m => isActive(m[MI.TRACK_STOCK]) && (parseInt(m[MI.STOCK_QTY]) || 0) <= 5);

    const pyData = getSheetData(SHEETS.PAYMENTS);
    const todayCollections = pyData.filter(p => p[PAY.TYPE] === 'customer_payment' && (p[PAY.DATE] instanceof Date ? p[PAY.DATE].toISOString().split('T')[0] : String(p[PAY.DATE])) === todayStr);
    const todayCollectionAmt = todayCollections.reduce((s, p) => s + (parseFloat(p[PAY.AMT]) || 0), 0);

    const custData = getSheetData(SHEETS.CUSTOMERS);
    const custMap = {}; custData.forEach(c => { custMap[c[CU.ID]] = c[CU.NAME]; });
    const totalCustDue = custData.reduce((s, c) => s + (parseFloat(c[CU.DUE]) || 0), 0);
    const puData = getSheetData(SHEETS.PURCHASES);
    const totalSuppDue = puData.filter(p => p[PU.STATUS] !== 'cancelled').reduce((s, p) => s + (parseFloat(p[PU.DUE]) || 0), 0);

    const exData = getSheetData(SHEETS.EXPENSES);
    const expThisMonth = exData.filter(e => new Date(e[EX.DATE]) >= mStart).reduce((s, e) => s + (parseFloat(e[EX.AMT]) || 0), 0);

    const dailySales = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const dayTotal = activeSales.filter(s => { const sd = s[SL.DATE] instanceof Date ? s[SL.DATE].toISOString().split('T')[0] : String(s[SL.DATE]).split('T')[0]; return sd === ds; }).reduce((s, sl) => s + (parseFloat(sl[SL.TOTAL]) || 0), 0);
      dailySales.push({ date: ds.substring(5), amount: dayTotal });
    }

    const siData = getSheetData(SHEETS.SALE_ITEMS);
    const menuAgg = {};
    siData.forEach(si => {
      const name = si[SI.NAME];
      if (!menuAgg[name]) menuAgg[name] = { name, qty: 0, revenue: 0 };
      menuAgg[name].qty += parseInt(si[SI.QTY]) || 1;
      menuAgg[name].revenue += parseFloat(si[SI.TOTAL]) || 0;
    });
    const topMenu = Object.values(menuAgg).sort((a,b) => b.qty - a.qty).slice(0, 10);

    const orderTypeDist = { dine_in: 0, takeaway: 0, delivery: 0 };
    activeSales.forEach(s => { const t = s[SL.ORDER_TYPE] || 'dine_in'; orderTypeDist[t] = (orderTypeDist[t] || 0) + 1; });

    const topCusts = custData.filter(c => parseFloat(c[CU.TOTAL]) > 0).map(c => ({ name: c[CU.NAME], total: parseFloat(c[CU.TOTAL]) || 0 })).sort((a, b) => b.total - a.total).slice(0, 10);

    const expBreakdown = {};
    exData.filter(e => new Date(e[EX.DATE]) >= mStart).forEach(e => { const cat = e[EX.CAT] || 'lainnya'; expBreakdown[cat] = (expBreakdown[cat] || 0) + (parseFloat(e[EX.AMT]) || 0); });

    const recentSales = activeSales.slice(-10).reverse().map(s => ({
      invoice_no: s[SL.INV_NO], total: parseFloat(s[SL.TOTAL]) || 0,
      customer: s[SL.CUST_ID] ? (custMap[s[SL.CUST_ID]] || 'Tidak diketahui') : 'Umum',
      date: s[SL.DATE] instanceof Date ? s[SL.DATE].toISOString() : s[SL.DATE]
    }));
    const recentPayments = pyData.filter(p => p[PAY.TYPE] === 'customer_payment').slice(-5).reverse().map(p => ({
      amount: parseFloat(p[PAY.AMT]) || 0, method: p[PAY.METHOD] || '',
      date: p[PAY.DATE] instanceof Date ? p[PAY.DATE].toISOString().split('T')[0] : (p[PAY.DATE] || '')
    }));

    const todaySalesAmt = todaySales.reduce((s, sl) => s + (parseFloat(sl[SL.TOTAL]) || 0), 0);
    const myTodaySales = todaySales.filter(s => s[SL.CREATED_BY] == userId);
    const myTodaySalesAmt = myTodaySales.reduce((s, sl) => s + (parseFloat(sl[SL.TOTAL]) || 0), 0);
    const myTodayCollection = todayCollections.filter(p => p[PAY.CREATED_BY] == userId).reduce((s, p) => s + (parseFloat(p[PAY.AMT]) || 0), 0);
    const myMonthSales = activeSales.filter(s => s[SL.CREATED_BY] == userId && new Date(s[SL.DATE] instanceof Date ? s[SL.DATE] : s[SL.DATE]) >= mStart).reduce((s, sl) => s + (parseFloat(sl[SL.TOTAL]) || 0), 0);
    const myRecentSales = activeSales.filter(s => s[SL.CREATED_BY] == userId).slice(-10).reverse().map(s => ({
      invoice_no: s[SL.INV_NO], total: parseFloat(s[SL.TOTAL]) || 0,
      customer: s[SL.CUST_ID] ? (custMap[s[SL.CUST_ID]] || 'Tidak diketahui') : 'Umum',
      date: s[SL.DATE] instanceof Date ? s[SL.DATE].toISOString() : s[SL.DATE]
    }));

    return { success: true, data: {
      todaySalesAmt, todayCollectionAmt, totalCustDue, totalSuppDue, expThisMonth,
      dailySales, orderTypeDist, topCusts, expBreakdown, recentSales, recentPayments, topMenu,
      myTodaySalesAmt, myTodayCollection, myMonthSales, myRecentSales,
      availableMenuCount: availMenu.length, lowStockCount: lowStockMenu.length,
      lowStockItems: lowStockMenu.slice(0, 10).map(m => ({ name: m[MI.NAME], stock: parseInt(m[MI.STOCK_QTY]) || 0 })),
      pendingPurchases: puData.filter(p => p[PU.STATUS] === 'pending').length
    }};
  } catch (e) { console.error('getDashboardStats:', e); return { success: false, message: 'Gagal memuat statistik' }; }
}

function getLogs(userId, role, limit) {
  try {
    if (role !== 'admin') return { success: false, message: 'Akses ditolak' };
    const data = getSheetData(SHEETS.LOGS);
    const logs = data.map(r => ({
      id: r[L.ID], user_id: r[L.UID], username: r[L.UNAME], action: r[L.ACTION],
      table_name: r[L.TABLE], record_id: r[L.RID], details: r[L.DETAILS] || '',
      created_at: r[L.CREATED] instanceof Date ? r[L.CREATED].toISOString() : r[L.CREATED]
    }));
    const lim = Math.min(parseInt(limit) || 200, 500);
    return { success: true, data: logs.reverse().slice(0, lim) };
  } catch (e) { return { success: false, message: 'Gagal memuat log' }; }
}

function logActivity(uid, action, table, rid, details, uname) {
  try {
    const sh = getSheet(SHEETS.LOGS);
    const name = uname || getUsernameById(uid);
    sh.appendRow([getNextId(SHEETS.LOGS), uid, name, action, table, rid || '', details || '', ts()]);
  } catch (e) { console.error('logActivity:', e); }
}

function getReportsData(reportType, filters, userId, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return { success: false, message: 'Akses ditolak' };
    if (!reportType) return { success: false, message: 'Jenis laporan wajib diisi' };
    const f = filters || {};
    const dFrom = f.dateFrom ? new Date(f.dateFrom + 'T00:00:00') : null;
    const dTo = f.dateTo ? new Date(f.dateTo + 'T23:59:59') : null;
    const toD = v => v instanceof Date ? v : new Date(v);
    const toDs = v => { const d = toD(v); return isNaN(d) ? '' : d.toISOString().split('T')[0]; };
    const inRange = v => {
      if (!dFrom && !dTo) return true;
      const d = toD(v); if (isNaN(d)) return false;
      if (dFrom && d < dFrom) return false;
      if (dTo && d > dTo) return false;
      return true;
    };

    if (reportType === 'profit_loss') {
      const slData = getSheetData(SHEETS.SALES).filter(r => r[SL.STATUS] !== 'cancelled' && inRange(r[SL.DATE]));
      const puData = getSheetData(SHEETS.PURCHASES).filter(r => inRange(r[PU.DATE]));
      const exData = getSheetData(SHEETS.EXPENSES).filter(r => inRange(r[EX.DATE]));
      const totalSales = slData.reduce((s, r) => s + (parseFloat(r[SL.TOTAL]) || 0), 0);
      const totalPurchases = puData.reduce((s, r) => s + (parseFloat(r[PU.TOTAL]) || 0), 0);
      const totalExpenses = exData.reduce((s, r) => s + (parseFloat(r[EX.AMT]) || 0), 0);
      const dayMap = {};
      slData.forEach(r => { const d = toDs(r[SL.DATE]); if (d) { if (!dayMap[d]) dayMap[d] = { date: d, sales: 0, purchases: 0, expenses: 0 }; dayMap[d].sales += parseFloat(r[SL.TOTAL]) || 0; } });
      puData.forEach(r => { const d = toDs(r[PU.DATE]); if (d) { if (!dayMap[d]) dayMap[d] = { date: d, sales: 0, purchases: 0, expenses: 0 }; dayMap[d].purchases += parseFloat(r[PU.TOTAL]) || 0; } });
      exData.forEach(r => { const d = toDs(r[EX.DATE]); if (d) { if (!dayMap[d]) dayMap[d] = { date: d, sales: 0, purchases: 0, expenses: 0 }; dayMap[d].expenses += parseFloat(r[EX.AMT]) || 0; } });
      const dailyData = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
      return { success: true, data: {
        totalSales, totalPurchases, totalExpenses, grossProfit: totalSales - totalPurchases,
        netProfit: totalSales - totalPurchases - totalExpenses, salesCount: slData.length, purchasesCount: puData.length, dailyData
      }};
    }

    if (reportType === 'sales_summary') {
      const slData = getSheetData(SHEETS.SALES);
      const filtered = slData.filter(r => inRange(r[SL.DATE]));
      const active = filtered.filter(r => r[SL.STATUS] !== 'cancelled');
      const totalAmount = active.reduce((s, r) => s + (parseFloat(r[SL.TOTAL]) || 0), 0);
      const totalCount = active.length;
      const avgTicket = totalCount ? totalAmount / totalCount : 0;
      const groupBy = f.groupBy || 'daily';
      const gMap = {};
      active.forEach(r => {
        const d = toD(r[SL.DATE]); if (isNaN(d)) return;
        let label;
        if (groupBy === 'daily') label = toDs(r[SL.DATE]);
        else if (groupBy === 'weekly') { const jan1 = new Date(d.getFullYear(), 0, 1); const wk = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7); label = d.getFullYear() + '-M' + String(wk).padStart(2, '0'); }
        else label = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        if (!gMap[label]) gMap[label] = { label, amount: 0, count: 0 };
        gMap[label].amount += parseFloat(r[SL.TOTAL]) || 0; gMap[label].count++;
      });
      const groupedData = Object.values(gMap).sort((a, b) => a.label.localeCompare(b.label));
      const methodBreakdown = {};
      active.forEach(r => { const m = r[SL.METHOD] || 'tidak diketahui'; methodBreakdown[m] = (methodBreakdown[m] || 0) + (parseFloat(r[SL.TOTAL]) || 0); });
      const orderTypeBreakdown = {};
      active.forEach(r => { const t = r[SL.ORDER_TYPE] || 'dine_in'; orderTypeBreakdown[t] = (orderTypeBreakdown[t] || 0) + (parseFloat(r[SL.TOTAL]) || 0); });
      const statusBreakdown = {};
      filtered.forEach(r => { const st = r[SL.STATUS] || 'tidak diketahui'; if (!statusBreakdown[st]) statusBreakdown[st] = { count: 0, amount: 0 }; statusBreakdown[st].count++; statusBreakdown[st].amount += parseFloat(r[SL.TOTAL]) || 0; });
      return { success: true, data: { totalAmount, totalCount, avgTicket, groupedData, methodBreakdown, orderTypeBreakdown, statusBreakdown }};
    }

    if (reportType === 'menu_terlaris') {
      const slData = getSheetData(SHEETS.SALES).filter(r => r[SL.STATUS] !== 'cancelled' && inRange(r[SL.DATE]));
      const saleIds = new Set(slData.map(r => r[SL.ID]));
      const siData = getSheetData(SHEETS.SALE_ITEMS);
      const agg = {};
      siData.forEach(si => {
        if (!saleIds.has(si[SI.SALE_ID])) return;
        const name = si[SI.NAME];
        if (!agg[name]) agg[name] = { name, qty: 0, revenue: 0 };
        agg[name].qty += parseInt(si[SI.QTY]) || 1;
        agg[name].revenue += parseFloat(si[SI.TOTAL]) || 0;
      });
      const menu = Object.values(agg).sort((a,b) => b.qty - a.qty);
      return { success: true, data: { menu }};
    }

    if (reportType === 'customer_profit') {
      const slData = getSheetData(SHEETS.SALES).filter(r => r[SL.STATUS] !== 'cancelled' && inRange(r[SL.DATE]));
      const cuData = getSheetData(SHEETS.CUSTOMERS);
      const cuMap = cuData.reduce((m, r) => (m[r[CU.ID]] = { name: r[CU.NAME], phone: r[CU.PHONE] || '' }, m), {});
      const agg = {};
      slData.forEach(r => {
        const cid = r[SL.CUST_ID]; if (!cid) return;
        if (!agg[cid]) agg[cid] = { id: cid, name: '', phone: '', totalSales: 0, saleCount: 0 };
        agg[cid].totalSales += parseFloat(r[SL.TOTAL]) || 0; agg[cid].saleCount++;
      });
      const customers = Object.values(agg).map(c => { const cu = cuMap[c.id]; c.name = cu ? cu.name : 'Tidak diketahui'; c.phone = cu ? cu.phone : ''; c.avgTicket = c.saleCount ? c.totalSales / c.saleCount : 0; return c; }).sort((a, b) => b.totalSales - a.totalSales);
      return { success: true, data: { customers }};
    }

    return { success: false, message: 'Jenis laporan tidak dikenali: ' + reportType };
  } catch (e) { console.error('getReportsData:', e); return { success: false, message: 'Gagal membuat laporan' }; }
}

function getOverdueSummary(userId, role) {
  try {
    const cuData = getSheetData(SHEETS.CUSTOMERS);
    const slData = getSheetData(SHEETS.SALES);
    const puData = getSheetData(SHEETS.PURCHASES);
    const spData = getSheetData(SHEETS.SUPPLIERS);
    const now = Date.now();
    const toD = v => v instanceof Date ? v : new Date(v);
    const daysBetween = v => { const d = toD(v); return isNaN(d) ? 0 : Math.floor((now - d.getTime()) / 86400000); };
    const bucket = days => days <= 7 ? 'within_7' : days <= 15 ? 'within_15' : days <= 30 ? 'within_30' : 'over_30';
    const emptyBuckets = () => ({ within_7: 0, within_15: 0, within_30: 0, over_30: 0 });

    const custOldest = {};
    slData.forEach(r => {
      if (r[SL.STATUS] === 'cancelled' || (parseFloat(r[SL.DUE]) || 0) <= 0) return;
      const cid = r[SL.CUST_ID]; if (!cid) return;
      const d = toD(r[SL.DATE]); if (isNaN(d)) return;
      if (!custOldest[cid] || d < custOldest[cid]) custOldest[cid] = d;
    });
    const custBuckets = emptyBuckets();
    const customers = cuData.filter(r => (parseFloat(r[CU.DUE]) || 0) > 0).map(r => {
      const id = r[CU.ID], due = parseFloat(r[CU.DUE]) || 0;
      const oldest = custOldest[id]; const days = oldest ? daysBetween(oldest) : 0;
      if (days > 0) custBuckets[bucket(days)]++;
      return { id, name: r[CU.NAME], phone: r[CU.PHONE] || '', total_due: due, oldest_sale_date: oldest ? oldest.toISOString() : '', days_overdue: days };
    }).sort((a, b) => b.days_overdue - a.days_overdue);

    const suppAgg = {};
    puData.forEach(r => {
      if (r[PU.STATUS] === 'cancelled' || (parseFloat(r[PU.DUE]) || 0) <= 0) return;
      const sid = r[PU.SUPPLIER_ID]; const d = toD(r[PU.DATE]); const due = parseFloat(r[PU.DUE]) || 0;
      if (!suppAgg[sid]) suppAgg[sid] = { total_due: 0, oldest: null };
      suppAgg[sid].total_due += due;
      if (!isNaN(d) && (!suppAgg[sid].oldest || d < suppAgg[sid].oldest)) suppAgg[sid].oldest = d;
    });
    const spMap = spData.reduce((m, r) => (m[r[SP.ID]] = r, m), {});
    const suppBuckets = emptyBuckets();
    const suppliers = Object.keys(suppAgg).map(sid => {
      const a = suppAgg[sid], sp = spMap[sid];
      const days = a.oldest ? daysBetween(a.oldest) : 0;
      if (days > 0) suppBuckets[bucket(days)]++;
      return { id: parseInt(sid), name: sp ? sp[SP.NAME] : 'Tidak diketahui', phone: sp ? (sp[SP.PHONE] || '') : '', total_due: Math.round(a.total_due * 100) / 100, oldest_date: a.oldest ? a.oldest.toISOString() : '', days_overdue: days };
    }).sort((a, b) => b.days_overdue - a.days_overdue);

    const totalCustDue = customers.reduce((s, c) => s + c.total_due, 0);
    const totalSuppDue = suppliers.reduce((s, c) => s + c.total_due, 0);
    return { success: true, data: { customers, suppliers, buckets: { customers: custBuckets, suppliers: suppBuckets }, totalCustDue: Math.round(totalCustDue * 100) / 100, totalSuppDue: Math.round(totalSuppDue * 100) / 100 } };
  } catch (e) { console.error('getOverdueSummary:', e); return { success: false, message: 'Gagal memuat ringkasan tunggakan' }; }
}

function globalSearch(query, userId, role) {
  try {
    if (!query || !query.trim()) return { success: true, data: [] };
    const q = query.trim().toLowerCase();
    const results = []; const limit = 10;
    const cuData = getSheetData(SHEETS.CUSTOMERS);
    let cnt = 0;
    for (let i = 0; i < cuData.length && cnt < limit; i++) {
      const r = cuData[i];
      if ((String(r[CU.NAME]).toLowerCase().includes(q)) || (String(r[CU.PHONE]).toLowerCase().includes(q))) {
        results.push({ type: 'pelanggan', id: r[CU.ID], name: r[CU.NAME], phone: r[CU.PHONE] || '', total_due: parseFloat(r[CU.DUE]) || 0 }); cnt++;
      }
    }
    if (role !== 'kasir') {
      const spData = getSheetData(SHEETS.SUPPLIERS);
      let cnt2 = 0;
      for (let i = 0; i < spData.length && cnt2 < limit; i++) {
        const r = spData[i];
        if ((String(r[SP.NAME]).toLowerCase().includes(q)) || (String(r[SP.PHONE]).toLowerCase().includes(q))) {
          results.push({ type: 'supplier', id: r[SP.ID], name: r[SP.NAME], phone: r[SP.PHONE] || '' }); cnt2++;
        }
      }
    }
    const slData = getSheetData(SHEETS.SALES);
    let cnt3 = 0;
    for (let i = 0; i < slData.length && cnt3 < limit; i++) {
      const r = slData[i];
      if (String(r[SL.INV_NO]).toLowerCase().includes(q)) {
        results.push({ type: 'transaksi', id: r[SL.ID], invoice_no: r[SL.INV_NO], total: parseFloat(r[SL.TOTAL]) || 0, status: r[SL.STATUS] || '', date: r[SL.DATE] instanceof Date ? r[SL.DATE].toISOString() : r[SL.DATE] }); cnt3++;
      }
    }
    const miData = getSheetData(SHEETS.MENU_ITEMS);
    let miCnt = 0;
    for (let i = 0; i < miData.length && miCnt < limit; i++) {
      const r = miData[i];
      if (String(r[MI.NAME]).toLowerCase().includes(q)) {
        results.push({ type: 'menu', id: r[MI.ID], name: r[MI.NAME], price: parseFloat(r[MI.PRICE]) || 0, is_available: isActive(r[MI.AVAILABLE]) }); miCnt++;
      }
    }
    results.sort((a, b) => a.type.localeCompare(b.type));
    return { success: true, data: results };
  } catch (e) { console.error('globalSearch:', e); return { success: false, message: 'Pencarian gagal' }; }
}

function setupDemoData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let tmp = ss.insertSheet('_tmp_setup');
  ss.getSheets().forEach(s => { if (s.getName() !== '_tmp_setup') ss.deleteSheet(s); });
  const now = ts();

  let sh = ss.insertSheet(SHEETS.USERS);
  sh.appendRow(['ID','Nama Lengkap','Email','Telepon','Kata Sandi','Peran','Avatar','Aktif','Dibuat','Diperbarui','OTP','OTP Kedaluwarsa']);
  sh.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');
  sh.appendRow([1, 'Admin Warung', 'admin@demo.id', '081234567801', 'admin123', 'admin', '', 1, now, now, '', '']);
  sh.appendRow([2, 'Manager Dinda', 'manager@warungsejahtera.id', '081234567802', 'manager123', 'manager', '', 1, now, '', '', '']);
  sh.appendRow([3, 'Kasir Rina', 'kasir@warungsejahtera.id', '081234567803', 'kasir123', 'kasir', '', 1, now, '', '', '']);
  sh.appendRow([4, 'Kasir Banu', 'kasir2@warungsejahtera.id', '081234567804', 'kasir123', 'kasir', '', 1, now, '', '', '']);

  sh = ss.insertSheet(SHEETS.CATEGORIES);
  sh.appendRow(['ID','Nama','Deskripsi','Aktif','Dibuat Oleh','Dibuat']);
  sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');
  sh.appendRow([1, 'Makanan Utama', 'Menu makanan berat', 1, 1, now]);
  sh.appendRow([2, 'Minuman', 'Minuman dingin & panas', 1, 1, now]);
  sh.appendRow([3, 'Camilan', 'Snack & gorengan', 1, 1, now]);
  sh.appendRow([4, 'Dessert', 'Makanan penutup', 1, 2, now]);

  sh = ss.insertSheet(SHEETS.SUPPLIERS);
  sh.appendRow(['ID','Nama','Telepon','Alamat','Aktif','Dibuat Oleh','Dibuat']);
  sh.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');
  sh.appendRow([1, 'Toko Sembako Makmur', '081355667701', 'Jl. Pasar Baru No. 12', 1, 1, now]);
  sh.appendRow([2, 'Agen Ayam Jaya', '081355667702', 'Jl. Peternakan Raya No. 5', 1, 1, now]);

  sh = ss.insertSheet(SHEETS.MENU_ITEMS);
  sh.appendRow(['ID','Kategori ID','Nama','Deskripsi','Harga','Modal','Lacak Stok','Stok','Tersedia','Catatan','Dibuat Oleh','Dibuat','Diperbarui','Gambar']);
  sh.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');
  sh.appendRow([1, 1, 'Nasi Goreng Spesial', 'Nasi goreng telur & ayam', 22000, 9000, 0, 0, 1, '', 1, now, now, '']);
  sh.appendRow([2, 1, 'Ayam Geprek', 'Ayam geprek sambal bawang', 20000, 8500, 0, 0, 1, '', 1, now, now, '']);
  sh.appendRow([3, 2, 'Es Teh Manis', '', 5000, 1500, 1, 50, 1, '', 1, now, now, '']);
  sh.appendRow([4, 2, 'Es Jeruk', '', 7000, 2500, 1, 30, 1, '', 1, now, now, '']);
  sh.appendRow([5, 3, 'Tahu Crispy', '', 10000, 4000, 1, 20, 1, '', 2, now, now, '']);
  sh.appendRow([6, 4, 'Pisang Goreng Coklat Keju', '', 12000, 5000, 1, 15, 1, '', 2, now, now, '']);

  sh = ss.insertSheet(SHEETS.CUSTOMERS);
  sh.appendRow(['ID','Nama','Telepon','Alamat','Total Belanja','Total Bayar','Total Hutang','Aktif','Dibuat Oleh','Dibuat']);
  sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');
  sh.appendRow([1, 'Pelanggan Umum', '', '', 0, 0, 0, 1, 1, now]);
  sh.appendRow([2, 'Dewi Lestari', '081455667801', 'Jl. Melati Indah No. 2', 0, 0, 0, 1, 1, now]);

  sh = ss.insertSheet(SHEETS.PURCHASES);
  sh.appendRow(['ID','No Pembelian','Supplier ID','Nama Barang','Qty','Satuan','Harga Satuan','Total','Dibayar','Sisa','Tanggal','Catatan','Status','Dibuat Oleh','Dibuat','Diperbarui']);
  sh.getRange(1, 1, 1, 16).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');

  sh = ss.insertSheet(SHEETS.SALES);
  sh.appendRow(['ID','No Struk','Pelanggan ID','Tipe Pesanan','No Meja','Total Item','Subtotal','Diskon','Total Bayar','Dibayar','Sisa','Metode','Tanggal','Status','Catatan','Dibuat Oleh','Dibuat','Diperbarui']);
  sh.getRange(1, 1, 1, 18).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');

  sh = ss.insertSheet(SHEETS.SALE_ITEMS);
  sh.appendRow(['ID','Transaksi ID','Menu ID','Nama','Qty','Harga','Total','Catatan']);
  sh.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');

  sh = ss.insertSheet(SHEETS.EXPENSES);
  sh.appendRow(['ID','Judul','Kategori','Jumlah','Tanggal','Catatan','Dibuat Oleh','Dibuat']);
  sh.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');

  sh = ss.insertSheet(SHEETS.PAYMENTS);
  sh.appendRow(['ID','Transaksi ID','Pembelian ID','Tipe','Jumlah','Metode','Ref','Tanggal','Catatan','Dibuat Oleh','Dibuat']);
  sh.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');

  sh = ss.insertSheet(SHEETS.IMPORT_LOGS);
  sh.appendRow(['ID','Nama File','Kategori ID','Total Baris','Berhasil','Gagal','Status','Log Error','Dibuat Oleh','Dibuat']);
  sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');

  sh = ss.insertSheet(SHEETS.SETTINGS);
  sh.appendRow(['ID','Kunci','Nilai','Diperbarui Oleh','Diperbarui']);
  sh.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');
  sh.appendRow([1, 'business_name', 'Warung Sejahtera', 1, now]);
  sh.appendRow([2, 'business_address', 'Jl. Merdeka Timur No. 18', 1, now]);
  sh.appendRow([3, 'business_phone', '081234567809', 1, now]);
  sh.appendRow([4, 'currency_symbol', 'Rp', 1, now]);
  sh.appendRow([5, 'invoice_prefix', 'STRK', 1, now]);
  sh.appendRow([6, 'purchase_prefix', 'BELI', 1, now]);
  sh.appendRow([7, 'invoice_footer', 'Terima kasih atas kunjungan Anda!', 1, now]);
  sh.appendRow([8, 'theme_primary', '#1463f6', 1, now]);
  sh.appendRow([9, 'theme_primary_hover', '#0f4dbf', 1, now]);
  sh.appendRow([10, 'theme_accent', '#3b82f6', 1, now]);

  sh = ss.insertSheet(SHEETS.LOGS);
  sh.appendRow(['ID','User ID','Username','Aksi','Tabel','Record ID','Detail','Dibuat']);
  sh.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#1463f6').setFontColor('white');

  ss.deleteSheet(tmp);
  return 'Setup selesai! Login: admin@demo.id / admin123';
}