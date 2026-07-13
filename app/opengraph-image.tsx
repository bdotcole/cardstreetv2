import { ImageResponse } from 'next/og'

// Branded 1200x630 link-preview card for the ad-landing URL (and every reshare
// in LINE / Facebook / Messenger, where a link with no image renders as a bare
// grey box). Generated dynamically so there's no binary asset to maintain.
// Text is kept to the default-font glyph set (no accents / emoji) so it renders
// cleanly without shipping a custom font.

export const alt = 'CardStreet TCG - Thai Pokemon Card Marketplace'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '30px' }}>
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
                        CardStreet TCG
                    </div>
                </div>
                <div
                    style={{
                        display: 'flex',
                        fontSize: '78px',
                        fontWeight: 800,
                        color: '#ffffff',
                        lineHeight: 1.04,
                        letterSpacing: '-0.02em',
                    }}
                >
                    Thai Pokemon Card Marketplace
                </div>
                <div style={{ display: 'flex', fontSize: '34px', color: '#9fb2c4', marginTop: '30px' }}>
                    Buy, sell, scan with AI, and track your collection value.
                </div>
                <div
                    style={{
                        display: 'flex',
                        marginTop: '46px',
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
