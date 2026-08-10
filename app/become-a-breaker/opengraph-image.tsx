import { ImageResponse } from 'next/og'

// Link-preview card for /become-a-breaker, overriding the sitewide one from
// app/opengraph-image.tsx. Same construction as that file — dynamically
// generated from brand elements (the CS mark, the cyan/blue gradient, the
// rule), no binary asset to maintain, and no product photography we don't own.
// Text stays inside the default-font glyph set (no accents, no Thai, no emoji)
// so it renders without shipping a custom font — the Thai page shares this
// image, exactly as the Thai homepage shares the English root one.

export const alt = 'Become a Cardstreet Breaker - Cardstreet Live'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function BreakerOpengraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    height: '100%',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #0b1016 0%, #0f2530 55%, #0a1a20 100%)',
                    padding: '84px',
                    fontFamily: 'sans-serif',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '28px' }}>
                    <div
                        style={{
                            width: '60px',
                            height: '60px',
                            borderRadius: '16px',
                            background: 'linear-gradient(135deg, #22d3ee, #3b82f6)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '28px',
                            fontWeight: 800,
                            color: '#08161c',
                        }}
                    >
                        CS
                    </div>
                    <div
                        style={{
                            fontSize: '30px',
                            fontWeight: 800,
                            color: '#22d3ee',
                            letterSpacing: '0.2em',
                            textTransform: 'uppercase',
                        }}
                    >
                        Cardstreet Live
                    </div>
                </div>

                <div
                    style={{
                        display: 'flex',
                        fontSize: '28px',
                        fontWeight: 800,
                        color: '#84cc16',
                        letterSpacing: '0.16em',
                        textTransform: 'uppercase',
                        marginBottom: '18px',
                    }}
                >
                    Applications Now Open
                </div>

                <div
                    style={{
                        display: 'flex',
                        fontSize: '76px',
                        fontWeight: 800,
                        color: '#ffffff',
                        lineHeight: 1.04,
                        letterSpacing: '-0.02em',
                    }}
                >
                    Become a Founding Cardstreet Breaker
                </div>

                <div style={{ display: 'flex', fontSize: '32px', color: '#9fb2c4', marginTop: '26px' }}>
                    Host live TCG breaks for collectors across Thailand.
                </div>

                <div
                    style={{
                        display: 'flex',
                        marginTop: '42px',
                        height: '8px',
                        width: '170px',
                        background: 'linear-gradient(90deg, #22d3ee, #3b82f6)',
                        borderRadius: '999px',
                    }}
                />
            </div>
        ),
        { ...size },
    )
}
