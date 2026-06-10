'use client'

import { useState } from 'react'
import { validateThaiAddress, type ThaiAddress } from '@/lib/utils/addressValidation'
import GooglePlacesAddressInput from './GooglePlacesAddressInput'
import type { ParsedThaiAddress } from '@/lib/utils/parseGoogleAddress'

// Thai provinces list
const THAI_PROVINCES = [
    'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น',
    'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย',
    'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา',
    'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ',
    'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา',
    'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต',
    'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง',
    'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร',
    'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี',
    'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย',
    'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี'
]

interface ThaiAddressFormProps {
    onSubmit: (address: ThaiAddress) => void
    initialValues?: Partial<ThaiAddress>
}

export default function ThaiAddressForm({ onSubmit, initialValues }: ThaiAddressFormProps) {
    const [address, setAddress] = useState<ThaiAddress>({
        recipient_name: initialValues?.recipient_name || '',
        phone_number: initialValues?.phone_number || '',
        address_line1: initialValues?.address_line1 || '',
        address_line2: initialValues?.address_line2 || '',
        sub_district: initialValues?.sub_district || '',
        district: initialValues?.district || '',
        province: initialValues?.province || '',
        postal_code: initialValues?.postal_code || '',
    })

    const [errors, setErrors] = useState<Record<string, string>>({})

    const handleChange = (field: keyof ThaiAddress, value: string) => {
        setAddress(prev => ({ ...prev, [field]: value }))
        // Clear error for this field when user starts typing
        if (errors[field]) {
            setErrors(prev => {
                const newErrors = { ...prev }
                delete newErrors[field]
                return newErrors
            })
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        // Validate Thai address
        const validation = validateThaiAddress(address)

        if (!validation.isValid) {
            setErrors(validation.errors)
            return
        }

        onSubmit(address)
    }

    return (
        <form onSubmit={handleSubmit} className="thai-address-form">
            <div className="form-group">
                <label htmlFor="recipient_name">
                    ชื่อผู้รับ (Recipient Name) <span className="required">*</span>
                </label>
                <input
                    id="recipient_name"
                    type="text"
                    value={address.recipient_name}
                    onChange={(e) => handleChange('recipient_name', e.target.value)}
                    className={errors.recipient_name ? 'error' : ''}
                    required
                />
                {errors.recipient_name && <div className="error-message">{errors.recipient_name}</div>}
            </div>

            <div className="form-group">
                <label htmlFor="phone_number">
                    เบอร์โทรศัพท์ (Phone Number) <span className="required">*</span>
                </label>
                <input
                    id="phone_number"
                    type="tel"
                    placeholder="0812345678"
                    value={address.phone_number}
                    onChange={(e) => handleChange('phone_number', e.target.value)}
                    className={errors.phone_number ? 'error' : ''}
                    maxLength={10}
                    required
                />
                {errors.phone_number && <div className="error-message">{errors.phone_number}</div>}
            </div>

            <div className="form-group">
                <label>
                    ค้นหาที่อยู่ (Search Address)
                </label>
                <GooglePlacesAddressInput
                    onAddressParsed={(parsed: ParsedThaiAddress, rawFormatted: string) => {
                        setAddress(prev => ({
                            ...prev,
                            address_line1: parsed.detail_address || rawFormatted,
                            province: parsed.province || prev.province,
                            district: parsed.district || prev.district,
                            sub_district: parsed.sub_district || prev.sub_district,
                            postal_code: parsed.postal_code || prev.postal_code,
                        }))
                    }}
                    className="w-full h-12 px-4 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                    ค้นหาเพื่อเติมข้อมูลอัตโนมัติ (Search to auto-fill fields below)
                </p>
            </div>

            <div className="form-group">
                <label htmlFor="address_line1">
                    ที่อยู่ (Address Line 1) <span className="required">*</span>
                </label>
                <input
                    id="address_line1"
                    type="text"
                    placeholder="บ้านเลขที่, หมู่, ถนน"
                    value={address.address_line1}
                    onChange={(e) => handleChange('address_line1', e.target.value)}
                    className={errors.address_line1 ? 'error' : ''}
                    required
                />
                {errors.address_line1 && <div className="error-message">{errors.address_line1}</div>}
            </div>

            <div className="form-group">
                <label htmlFor="address_line2">
                    ที่อยู่เพิ่มเติม (Address Line 2)
                </label>
                <input
                    id="address_line2"
                    type="text"
                    placeholder="อาคาร, ห้อง (ถ้ามี)"
                    value={address.address_line2}
                    onChange={(e) => handleChange('address_line2', e.target.value)}
                />
            </div>

            <div className="form-row">
                <div className="form-group">
                    <label htmlFor="province">
                        จังหวัด (Province) <span className="required">*</span>
                    </label>
                    <select
                        id="province"
                        value={address.province}
                        onChange={(e) => handleChange('province', e.target.value)}
                        className={errors.province ? 'error' : ''}
                        required
                    >
                        <option value="">เลือกจังหวัด</option>
                        {THAI_PROVINCES.map(province => (
                            <option key={province} value={province}>{province}</option>
                        ))}
                    </select>
                    {errors.province && <div className="error-message">{errors.province}</div>}
                </div>

                <div className="form-group">
                    <label htmlFor="postal_code">
                        รหัสไปรษณีย์ (Postal Code) <span className="required">*</span>
                    </label>
                    <input
                        id="postal_code"
                        type="text"
                        placeholder="10100"
                        value={address.postal_code}
                        onChange={(e) => handleChange('postal_code', e.target.value)}
                        className={errors.postal_code ? 'error' : ''}
                        maxLength={5}
                        pattern="\d{5}"
                        required
                    />
                    {errors.postal_code && <div className="error-message">{errors.postal_code}</div>}
                </div>
            </div>

            <div className="form-row">
                <div className="form-group">
                    <label htmlFor="district">
                        อำเภอ/เขต (District) <span className="required">*</span>
                    </label>
                    <input
                        id="district"
                        type="text"
                        value={address.district}
                        onChange={(e) => handleChange('district', e.target.value)}
                        className={errors.district ? 'error' : ''}
                        required
                    />
                    {errors.district && <div className="error-message">{errors.district}</div>}
                </div>

                <div className="form-group">
                    <label htmlFor="sub_district">
                        ตำบล/แขวง (Sub-district) <span className="required">*</span>
                    </label>
                    <input
                        id="sub_district"
                        type="text"
                        value={address.sub_district}
                        onChange={(e) => handleChange('sub_district', e.target.value)}
                        className={errors.sub_district ? 'error' : ''}
                        required
                    />
                    {errors.sub_district && <div className="error-message">{errors.sub_district}</div>}
                </div>
            </div>

            <button type="submit" className="submit-button">
                บันทึกที่อยู่ (Save Address)
            </button>

            <style jsx>{`
        .thai-address-form {
          max-width: 600px;
          margin: 0 auto;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }

        label {
          display: block;
          margin-bottom: 8px;
          font-weight: 600;
          color: #333;
        }

        .required {
          color: #d32f2f;
        }

        input,
        select {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 14px;
          transition: border-color 0.2s;
        }

        input:focus,
        select:focus {
          outline: none;
          border-color: #4caf50;
        }

        input.error,
        select.error {
          border-color: #d32f2f;
        }

        .error-message {
          margin-top: 4px;
          color: #d32f2f;
          font-size: 12px;
        }

        .submit-button {
          width: 100%;
          padding: 14px;
          background: #4caf50;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }

        .submit-button:hover {
          background: #45a049;
        }

        @media (max-width: 600px) {
          .form-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
        </form>
    )
}
