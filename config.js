/* Konfigurasi global aplikasi POS Warung (Multi-Tenant Frontend) */

const CONFIG = {
  APP_NAME: 'Point of Sale Warungan',
  VERSION: '1.0.0',


  REGISTRY_URL: 'https://script.google.com/macros/s/AKfycbxjjYjUMpz5UXiwUqjISPh12KDy0dvDN4fY12PbD1IVorRs1RdeEbJFGhF7wi4pNUlO/exec',


  API_URL: null,
  WARUNG_CODE: null,
  WARUNG_NAME: null,


  THEME_COLOR: '#1463f6',
  THEME_COLOR_HOVER: '#0f4dbf',
  THEME_ACCENT: '#3b82f6',

  LOCAL_STORAGE_KEY: 'pos_warung_session'
};


const STORAGE_KEYS = {
  API_URL: 'pos_api_url',
  WARUNG_CODE: 'pos_warung_code',
  WARUNG_NAME: 'pos_warung_name',
  USER: 'pos_user',
  THEME: 'pos_theme'
};


function loadStoredConfig() {
  try {
    const apiUrl = localStorage.getItem(STORAGE_KEYS.API_URL);
    const warungCode = localStorage.getItem(STORAGE_KEYS.WARUNG_CODE);
    const warungName = localStorage.getItem(STORAGE_KEYS.WARUNG_NAME);

    if (apiUrl) {
      CONFIG.API_URL = apiUrl;
      CONFIG.WARUNG_CODE = warungCode || null;
      CONFIG.WARUNG_NAME = warungName || null;
      return true;
    }
    return false;
  } catch (e) {
    console.error('loadStoredConfig:', e);
    return false;
  }
}


function saveWarungConnection(warungCode, apiUrl, warungName) {
  try {
    localStorage.setItem(STORAGE_KEYS.API_URL, apiUrl);
    localStorage.setItem(STORAGE_KEYS.WARUNG_CODE, warungCode);
    if (warungName) localStorage.setItem(STORAGE_KEYS.WARUNG_NAME, warungName);

    CONFIG.API_URL = apiUrl;
    CONFIG.WARUNG_CODE = warungCode;
    CONFIG.WARUNG_NAME = warungName || null;
    return true;
  } catch (e) {
    console.error('saveWarungConnection:', e);
    return false;
  }
}


function clearWarungConnection() {
  try {
    localStorage.removeItem(STORAGE_KEYS.API_URL);
    localStorage.removeItem(STORAGE_KEYS.WARUNG_CODE);
    localStorage.removeItem(STORAGE_KEYS.WARUNG_NAME);
    localStorage.removeItem(STORAGE_KEYS.USER);

    CONFIG.API_URL = null;
    CONFIG.WARUNG_CODE = null;
    CONFIG.WARUNG_NAME = null;
  } catch (e) {
    console.error('clearWarungConnection:', e);
  }
}


function getStoredJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('getStoredJSON:', key, e);
    return null;
  }
}

function setStoredJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('setStoredJSON:', key, e);
    return false;
  }
}