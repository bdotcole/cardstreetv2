'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ShippingLabel {
    id: string
    tracking_number: string
    label_url: string
    carrier_name: string
    status: string
    courier_tracking_url: string | null
}

interface ShippingLabelPrintProps {
    orderId: string
}

export default function ShippingLabelPrint({ orderId }: ShippingLabelPrintProps) {
    const [label, setLabel] = useState<ShippingLabel | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [generating, setGenerating] = useState(false)

    useEffect(() => {
        fetchLabel()
    }, [orderId])

    const fetchLabel = async () => {
        try {
            const supabase = createClient()

            const { data, error } = await supabase
                .from('shipping_labels')
                .select('*')
                .eq('order_id', orderId)
                .single()

            if (error && error.code !== 'PGRST116') {
                throw error
            }

            setLabel(data)
        } catch (err: any) {
            console.error('Error fetching label:', err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const generateLabel = async () => {
        try {
            setGenerating(true)
            setError(null)

            const response = await fetch(
                `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-shipping-label`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
                    },
                    body: JSON.stringify({ orderId }),
                }
            )

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.error || 'Failed to generate label')
            }

            // Refresh label data
            await fetchLabel()
        } catch (err: any) {
            console.error('Error generating label:', err)
            setError(err.message)
        } finally {
            setGenerating(false)
        }
    }

    const handlePrint = () => {
        if (label?.label_url) {
            window.open(label.label_url, '_blank')
        }
    }

    const handleTrack = () => {
        if (label?.courier_tracking_url) {
            window.open(label.courier_tracking_url, '_blank')
        }
    }

    if (loading) {
        return (
            <div className="shipping-label-container">
                <div className="loading">Loading shipping information...</div>
            </div>
        )
    }

    if (error) {
        // Surface only a short user-readable message. The raw error is in the
        // console for support to inspect; don't render server payloads verbatim
        // because they sometimes include internal field names.
        return (
            <div className="shipping-label-container">
                <div className="error">
                    Couldn't load the shipping label. Try again, or contact support if the issue persists.
                </div>
            </div>
        )
    }

    if (!label) {
        return (
            <div className="shipping-label-container">
                <h3>📦 Shipping Label</h3>
                <p>No shipping label generated yet</p>
                <button
                    onClick={generateLabel}
                    disabled={generating}
                    className="generate-button"
                >
                    {generating ? 'Generating...' : '🏷️ Generate Shipping Label'}
                </button>
            </div>
        )
    }

    return (
        <div className="shipping-label-container">
            <h3>📦 Shipping Label</h3>

            <div className="label-info">
                <div className="info-row">
                    <span className="label">Tracking Number:</span>
                    <span className="value">{label.tracking_number}</span>
                </div>
                <div className="info-row">
                    <span className="label">Carrier:</span>
                    <span className="value">{label.carrier_name}</span>
                </div>
                <div className="info-row">
                    <span className="label">Status:</span>
                    <span className={`status status-${label.status}`}>
                        {label.status.replace('_', ' ').toUpperCase()}
                    </span>
                </div>
            </div>

            <div className="button-group">
                <button onClick={handlePrint} className="print-button">
                    🖨️ Print Shipping Label
                </button>
                {label.courier_tracking_url && (
                    <button onClick={handleTrack} className="track-button">
                        🔍 Track Package
                    </button>
                )}
            </div>

            {label.label_url && (
                <div className="label-preview">
                    <h4>Label Preview:</h4>
                    <embed
                        src={label.label_url}
                        width="100%"
                        height="400px"
                        type="application/pdf"
                    />
                </div>
            )}

            <style jsx>{`
        .shipping-label-container {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 20px;
          margin: 20px 0;
        }

        h3 {
          margin-top: 0;
          color: #333;
        }

        .loading, .error {
          padding: 20px;
          text-align: center;
        }

        .error {
          color: #d32f2f;
          background: #ffebee;
          border-radius: 4px;
        }

        .label-info {
          margin: 20px 0;
        }

        .info-row {
          display: flex;
          padding: 10px 0;
          border-bottom: 1px solid #f0f0f0;
        }

        .info-row .label {
          font-weight: 600;
          width: 150px;
          color: #666;
        }

        .info-row .value {
          flex: 1;
          color: #333;
        }

        .status {
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .status-created {
          background: #e3f2fd;
          color: #1976d2;
        }

        .status-picked_up,
        .status-in_transit {
          background: #fff3e0;
          color: #f57c00;
        }

        .status-delivered {
          background: #e8f5e9;
          color: #388e3c;
        }

        .button-group {
          display: flex;
          gap: 10px;
          margin: 20px 0;
        }

        .print-button,
        .track-button,
        .generate-button {
          padding: 12px 24px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .print-button {
          background: #4caf50;
          color: white;
        }

        .print-button:hover {
          background: #45a049;
        }

        .track-button {
          background: #2196f3;
          color: white;
        }

        .track-button:hover {
          background: #1976d2;
        }

        .generate-button {
          background: #ff9800;
          color: white;
          width: 100%;
        }

        .generate-button:hover {
          background: #f57c00;
        }

        .generate-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .label-preview {
          margin-top: 20px;
        }

        h4 {
          color: #666;
          margin-bottom: 10px;
        }
      `}</style>
        </div>
    )
}
