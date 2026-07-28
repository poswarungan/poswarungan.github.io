/**
 * api-client.js
 * Frontend API client — satu-satunya jembatan antara React app (app.js)
 * dan backend Apps Script (via REGISTRY_URL untuk onboarding, CONFIG.API_URL untuk operasional).
 * Dibutuhkan oleh app.js (yang memanggil API.xxx() di banyak tempat).
 */
;(function() {
  'use strict';

  /* ── Helper: panggil warung backend ── */
  async function _call(action, params) {
    if (!CONFIG.API_URL) throw new Error('API_URL belum diatur — hubungkan warung dulu');
    const body = { action: action };
    if (params) Object.assign(body, params);
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    try { return JSON.parse(text); }
    catch(e) { return { success: false, message: 'Respon tidak valid dari server: ' + text.substring(0,100) }; }
  }

  /* ── Helper: panggil Registry ── */
  async function _callRegistry(params) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(CONFIG.REGISTRY_URL + '?' + qs);
    const text = await res.text();
    try { return JSON.parse(text); }
    catch(e) { return { success: false, message: 'Respon tidak valid dari registry' }; }
  }

  window.API = {

    // ─── Onboarding ───
    async connectWarung(code) {
      const r = await _callRegistry({ code: code });
      if (r.success && r.url) saveWarungConnection(code, r.url, r.name);
      return r;
    },
    async registerWarung(code, url, name) {
      const r = await _callRegistry({ action: 'register', code: code, url: url, name: name });
      if (r.success) saveWarungConnection(code, url, name);
      return r;
    },
    disconnectWarung() {
      clearWarungConnection();
    },

    // ─── Auth ───
    async login(email, password) {
      return _call('login', { email: email, password: password });
    },
    async sendForgotOTP(email) {
      return _call('sendForgotOTP', { email: email });
    },
    async resetPassword(email, otp, newPassword) {
      return _call('resetPassword', { email: email, otp: otp, newPassword: newPassword });
    },
    async changePassword(userId, currentPassword, newPassword) {
      return _call('changePassword', { userId: userId, currentPassword: currentPassword, newPassword: newPassword });
    },

    // ─── Settings ───
    async getSettings() {
      return _call('getSettings');
    },
    async saveAllSettings(settingsObj, userId, role) {
      return _call('saveAllSettings', { settingsObj: JSON.stringify(settingsObj), userId: userId, role: role });
    },
    async saveBusinessLogo(logoData, userId, role) {
      return _call('saveBusinessLogo', { logoData: JSON.stringify(logoData), userId: userId, role: role });
    },
    async removeBusinessLogo(userId, role) {
      return _call('removeBusinessLogo', { userId: userId, role: role });
    },

    // ─── Users ───
    async getUsers(userId, role) {
      return _call('getUsers', { userId: userId, role: role });
    },
    async addUser(userData, userId, role) {
      return _call('addUser', { userData: JSON.stringify(userData), userId: userId, role: role });
    },
    async updateUser(userData, userId, role) {
      return _call('updateUser', { userData: JSON.stringify(userData), userId: userId, role: role });
    },
    async deleteUser(id, userId, role) {
      return _call('deleteUser', { id: id, userId: userId, role: role });
    },
    async toggleUserStatus(id, userId, role) {
      return _call('toggleUserStatus', { id: id, userId: userId, role: role });
    },

    // ─── Profile ───
    async getProfile(userId) {
      return _call('getProfile', { userId: userId });
    },
    async updateProfile(profileData, userId) {
      return _call('updateProfile', { profileData: JSON.stringify(profileData), userId: userId });
    },

    // ─── Categories ───
    async getCategories(userId, role) {
      return _call('getCategories', { userId: userId, role: role });
    },
    async addCategory(catData, userId, role) {
      return _call('addCategory', { catData: JSON.stringify(catData), userId: userId, role: role });
    },
    async updateCategory(catData, userId, role) {
      return _call('updateCategory', { catData: JSON.stringify(catData), userId: userId, role: role });
    },
    async deleteCategory(id, userId, role) {
      return _call('deleteCategory', { id: id, userId: userId, role: role });
    },
    async toggleCategoryStatus(id, userId, role) {
      return _call('toggleCategoryStatus', { id: id, userId: userId, role: role });
    },
    async checkCategoryName(name, excludeId) {
      return _call('checkCategoryName', { name: name, excludeId: excludeId });
    },
    async getCategoriesForDropdown() {
      return _call('getCategoriesForDropdown');
    },

    // ─── Suppliers ───
    async getSuppliers(userId, role) {
      return _call('getSuppliers', { userId: userId, role: role });
    },
    async addSupplier(spData, userId, role) {
      return _call('addSupplier', { spData: JSON.stringify(spData), userId: userId, role: role });
    },
    async updateSupplier(spData, userId, role) {
      return _call('updateSupplier', { spData: JSON.stringify(spData), userId: userId, role: role });
    },
    async deleteSupplier(id, userId, role) {
      return _call('deleteSupplier', { id: id, userId: userId, role: role });
    },
    async toggleSupplierStatus(id, userId, role) {
      return _call('toggleSupplierStatus', { id: id, userId: userId, role: role });
    },
    async getSupplierLedger(supplierId, userId, role) {
      return _call('getSupplierLedger', { supplierId: supplierId, userId: userId, role: role });
    },
    async getSuppliersForDropdown() {
      return _call('getSuppliersForDropdown');
    },

    // ─── Purchases ───
    async getPurchases(userId, role) {
      return _call('getPurchases', { userId: userId, role: role });
    },
    async addPurchase(puData, userId, role) {
      return _call('addPurchase', { puData: JSON.stringify(puData), userId: userId, role: role });
    },
    async updatePurchase(puData, userId, role) {
      return _call('updatePurchase', { puData: JSON.stringify(puData), userId: userId, role: role });
    },
    async deletePurchase(id, userId, role) {
      return _call('deletePurchase', { id: id, userId: userId, role: role });
    },
    async getPurchaseDetail(id, userId, role) {
      return _call('getPurchaseDetail', { id: id, userId: userId, role: role });
    },
    async addPayment(payData, userId, role) {
      return _call('addPayment', { payData: JSON.stringify(payData), userId: userId, role: role });
    },

    // ─── Menu ───
    async getMenuItems(userId, role) {
      return _call('getMenuItems', { userId: userId, role: role });
    },
    async addMenuItem(miData, userId, role) {
      return _call('addMenuItem', { miData: JSON.stringify(miData), userId: userId, role: role });
    },
    async updateMenuItem(miData, userId, role) {
      return _call('updateMenuItem', { miData: JSON.stringify(miData), userId: userId, role: role });
    },
    async toggleMenuAvailability(id, userId, role) {
      return _call('toggleMenuAvailability', { id: id, userId: userId, role: role });
    },
    async deleteMenuItem(id, userId, role) {
      return _call('deleteMenuItem', { id: id, userId: userId, role: role });
    },
    async checkMenuName(name, excludeId) {
      return _call('checkMenuName', { name: name, excludeId: excludeId });
    },
    async getAvailableMenu(catId) {
      return _call('getAvailableMenu', { catId: catId || 0 });
    },
    async searchMenu(query) {
      return _call('searchMenu', { query: query });
    },
    async bulkImportMenu(items, catId, userId, role) {
      return _call('bulkImportMenu', { items: JSON.stringify(items), catId: catId, userId: userId, role: role });
    },
    async getMenuItemDetail(id) {
      return _call('getMenuItemDetail', { id: id });
    },
    async updateMenuStock(id, newStock, userId, role) {
      return _call('updateMenuStock', { id: id, newStock: newStock, userId: userId, role: role });
    },

    // ─── Customers ───
    async getCustomers(userId, role) {
      return _call('getCustomers', { userId: userId, role: role });
    },
    async addCustomer(cuData, userId, role) {
      return _call('addCustomer', { cuData: JSON.stringify(cuData), userId: userId, role: role });
    },
    async updateCustomer(cuData, userId, role) {
      return _call('updateCustomer', { cuData: JSON.stringify(cuData), userId: userId, role: role });
    },
    async deleteCustomer(id, userId, role) {
      return _call('deleteCustomer', { id: id, userId: userId, role: role });
    },
    async toggleCustomerStatus(id, userId, role) {
      return _call('toggleCustomerStatus', { id: id, userId: userId, role: role });
    },
    async getCustomerLedger(custId, userId, role) {
      return _call('getCustomerLedger', { custId: custId, userId: userId, role: role });
    },
    async addCustomerPayment(payData, userId, role) {
      return _call('addCustomerPayment', { payData: JSON.stringify(payData), userId: userId, role: role });
    },
    async getCustomersForDropdown() {
      return _call('getCustomersForDropdown');
    },

    // ─── Sales / POS ───
    async completeSale(saleData, userId, role) {
      return _call('completeSale', { saleData: JSON.stringify(saleData), userId: userId, role: role });
    },
    async getSales(userId, role) {
      return _call('getSales', { userId: userId, role: role });
    },
    async getSaleDetail(id, userId, role) {
      return _call('getSaleDetail', { id: id, userId: userId, role: role });
    },
    async cancelSale(id, reason, userId, role) {
      return _call('cancelSale', { id: id, reason: reason, userId: userId, role: role });
    },
    async updateSale(saleData, userId, role) {
      return _call('updateSale', { saleData: JSON.stringify(saleData), userId: userId, role: role });
    },
    async addSaleItem(saleId, menuItemId, qty, userId, role) {
      return _call('addSaleItem', { saleId: saleId, menuItemId: menuItemId, qty: qty, userId: userId, role: role });
    },
    async removeSaleItem(saleItemId, saleId, userId, role) {
      return _call('removeSaleItem', { saleItemId: saleItemId, saleId: saleId, userId: userId, role: role });
    },
    async deleteSale(id, userId, role) {
      return _call('deleteSale', { id: id, userId: userId, role: role });
    },
    async returnSaleItem(saleItemId, saleId, reason, userId, role) {
      return _call('returnSaleItem', { saleItemId: saleItemId, saleId: saleId, reason: reason, userId: userId, role: role });
    },

    // ─── Payments ───
    async getPayments(userId, role) {
      return _call('getPayments', { userId: userId, role: role });
    },

    // ─── Expenses ───
    async getExpenses(userId, role) {
      return _call('getExpenses', { userId: userId, role: role });
    },
    async addExpense(exData, userId, role) {
      return _call('addExpense', { exData: JSON.stringify(exData), userId: userId, role: role });
    },
    async updateExpense(exData, userId, role) {
      return _call('updateExpense', { exData: JSON.stringify(exData), userId: userId, role: role });
    },
    async deleteExpense(id, userId, role) {
      return _call('deleteExpense', { id: id, userId: userId, role: role });
    },

    // ─── Import Logs ───
    async getImportLogs(userId, role) {
      return _call('getImportLogs', { userId: userId, role: role });
    },

    // ─── Dashboard & Reports ───
    async getDashboardStats(userId, role) {
      return _call('getDashboardStats', { userId: userId, role: role });
    },
    async getOverdueSummary(userId, role) {
      return _call('getOverdueSummary', { userId: userId, role: role });
    },
    async getReportsData(reportType, filters, userId, role) {
      return _call('getReportsData', { reportType: reportType, filters: JSON.stringify(filters), userId: userId, role: role });
    },

    // ─── Logs ───
    async getLogs(userId, role, limit) {
      return _call('getLogs', { userId: userId, role: role, limit: limit });
    },

    // ─── Search ───
    async globalSearch(query, userId, role) {
      return _call('globalSearch', { query: query, userId: userId, role: role });
    }
  };

})();
