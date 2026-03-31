export default function Helpcenter() {
    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-lg)' }}>
                Helpcenter
            </h1>
            <div className="card">
                <div className="card-header">
                    <span className="card-title">Willkommen im Helpcenter</span>
                </div>
                <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                    Hier finden Sie in Kürze Anleitungen, FAQs und Dokumentation zur Nutzung von MIKE WorkSpace.
                </p>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
                    Für direkte Unterstützung wenden Sie sich bitte an Ihren Administrator.
                </p>
            </div>
        </div>
    );
}
