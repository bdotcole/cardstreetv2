/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./App.{js,jsx,ts,tsx}",
        "./app/**/*.{js,jsx,ts,tsx}",
        "./components/**/*.{js,jsx,ts,tsx}",
        "./screens/**/*.{js,jsx,ts,tsx}",
        "./navigation/**/*.{js,jsx,ts,tsx}",
    ],
    presets: [require("nativewind/preset")],
    theme: {
        extend: {
            colors: {
                brand: {
                    cyan: '#06b6d4',
                    purple: '#bc13fe',
                    darker: '#0f172a',
                    green: '#10b981',
                    red: '#ef4444',
                }
            }
        },
    },
    plugins: [],
}

