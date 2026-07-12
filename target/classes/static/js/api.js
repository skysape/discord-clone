// Обёртка над fetch для запросов к API с авторизацией по токену
const Api = {
  token: null,

  init() {
    this.token = localStorage.getItem('token');
  },

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  },

  async request(method, url, body, isMultipart = false) {
    const headers = {};
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;

    let fetchBody = undefined;
    if (body !== undefined) {
      if (isMultipart) {
        fetchBody = body; // FormData
      } else {
        headers['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify(body);
      }
    }

    const res = await fetch(url, { method, headers, body: fetchBody });
    let data = null;
    try { data = await res.json(); } catch (e) { /* пустой ответ */ }

    if (!res.ok) {
      const message = (data && data.error) ? data.error : ('Ошибка запроса: ' + res.status);
      throw new Error(message);
    }
    return data;
  },

  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body || {}); },
  put(url, body) { return this.request('PUT', url, body || {}); },
  del(url) { return this.request('DELETE', url); },
  postForm(url, formData) { return this.request('POST', url, formData, true); }
};

Api.init();
