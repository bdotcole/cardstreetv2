import React from 'react';

interface LanguagePickerProps {
    currentLanguage: 'TH' | 'EN';
    onLanguageChange: (lang: 'TH' | 'EN') => void;
}

/**
 * Language Picker Component
 * Displays TH/EN text and toggles between Thai and English
 */
const LanguagePicker: React.FC<LanguagePickerProps> = ({ currentLanguage, onLanguageChange }) => {
    const toggleLanguage = () => {
        const newLang = currentLanguage === 'TH' ? 'EN' : 'TH';
        onLanguageChange(newLang);
    };

    return (
        <button
            onClick={toggleLanguage}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition-all group"
            title={currentLanguage === 'TH' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
        >
            <span className="text-[10px] font-black text-slate-300 group-hover:text-white transition-colors">
                {currentLanguage}
            </span>
        </button>
    );
};

export default LanguagePicker;
