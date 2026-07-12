// Простая система интернационализации: ru, be, pl, en
const I18N = {
  current: 'ru',
  dict: {},

  async load(lang) {
    if (!['ru', 'be', 'pl', 'en'].includes(lang)) lang = 'ru';
    const res = await fetch(`/i18n/${lang}.json`);
    this.dict = await res.json();
    this.current = lang;
    document.documentElement.lang = lang;
    this.apply();
  },

  t(key) {
    return this.dict[key] || key;
  },

  apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = this.t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.setAttribute('placeholder', this.t(key));
    });
    document.title = this.t('app_title');
  }
};
