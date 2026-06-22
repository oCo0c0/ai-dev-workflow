import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';

const savedLocale = localStorage.getItem('locale') || 'zh';

void i18n.use(initReactI18next).init({
    resources: {
        zh: {translation: zh},
        en: {translation: en},
    },
    lng: savedLocale,
    fallbackLng: 'zh',
    interpolation: {escapeValue: false},
});
