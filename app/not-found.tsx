// App-level 404. Renders inside the root layout (themed shell), so it inherits
// the current light/dark theme rather than hardcoding colors. Bilingual with
// Thai first, since Thai is the default market language.
export default function NotFound() {
    return (
        <div className="min-h-[70vh] flex items-center justify-center px-6 text-center">
            <div className="max-w-md">
                <p className="text-6xl font-black tracking-tight mb-3 opacity-90">404</p>
                <h1 className="text-xl font-bold mb-2">ไม่พบหน้านี้ · Page not found</h1>
                <p className="opacity-70 mb-6 text-sm leading-relaxed">
                    หน้าที่คุณกำลังมองหาอาจถูกย้ายหรือลบไปแล้ว
                    <br />
                    The page you&apos;re looking for may have moved or no longer exists.
                </p>
                <a
                    href="/"
                    className="inline-block px-5 py-2.5 rounded-xl font-bold text-sm uppercase tracking-wider bg-brand-cyan text-black hover:opacity-90 transition-opacity"
                >
                    กลับหน้าหลัก · Back home
                </a>
            </div>
        </div>
    );
}
