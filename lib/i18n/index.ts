import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import vi from './locales/vi.json';

const resources = {
  vi: {
    translation: vi,
  },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'vi', // Mặc định dùng tiếng Việt
    fallbackLng: 'vi',
    interpolation: {
      escapeValue: false, // React đã tự escape XSS
    },
  });

export default i18n;
