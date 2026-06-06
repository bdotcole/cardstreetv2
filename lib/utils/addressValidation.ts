// Thai address validation utilities

export interface ThaiAddress {
    recipient_name: string
    phone_number: string
    address_line1: string
    address_line2?: string
    sub_district: string // ตำบล/แขวง
    district: string // อำเภอ/เขต
    province: string // จังหวัด
    postal_code: string
}

export interface ValidationResult {
    isValid: boolean
    errors: Record<string, string>
}

/**
 * Validates a Thai address for completeness and format
 */
export function validateThaiAddress(address: ThaiAddress): ValidationResult {
    const errors: Record<string, string> = {}

    // Recipient name validation
    if (!address.recipient_name || address.recipient_name.trim().length < 2) {
        errors.recipient_name = 'กรุณากรอกชื่อผู้รับอย่างน้อย 2 ตัวอักษร'
    }

    // Phone number validation (Thai format: 9-10 digits)
    if (!address.phone_number) {
        errors.phone_number = 'กรุณากรอกเบอร์โทรศัพท์'
    } else if (!/^0\d{8,9}$/.test(address.phone_number)) {
        errors.phone_number = 'เบอร์โทรศัพท์ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก'
    }

    // Address line 1 validation
    if (!address.address_line1 || address.address_line1.trim().length < 5) {
        errors.address_line1 = 'กรุณากรอกที่อยู่อย่างน้อย 5 ตัวอักษร'
    }

    // Province validation
    if (!address.province || address.province.trim() === '') {
        errors.province = 'กรุณาเลือกจังหวัด'
    }

    // District validation
    if (!address.district || address.district.trim() === '') {
        errors.district = 'กรุณากรอกอำเภอ/เขต'
    }

    // Sub-district validation
    if (!address.sub_district || address.sub_district.trim() === '') {
        errors.sub_district = 'กรุณากรอกตำบล/แขวง'
    }

    // Postal code validation (Thai format: exactly 5 digits)
    if (!address.postal_code) {
        errors.postal_code = 'กรุณากรอกรหัสไปรษณีย์'
    } else if (!/^\d{5}$/.test(address.postal_code)) {
        errors.postal_code = 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก'
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors,
    }
}

/**
 * Formats a Thai address for display
 */
export function formatThaiAddress(address: ThaiAddress): string {
    const parts = [
        address.address_line1,
        address.address_line2,
        `ตำบล${address.sub_district}`,
        `อำเภอ${address.district}`,
        `จังหวัด${address.province}`,
        address.postal_code,
    ].filter(Boolean)

    return parts.join(' ')
}

/**
 * Formats a Thai address for Flash Express API.
 * Maps to Flash Express field naming convention:
 *   - provinceName  = จังหวัด (province)
 *   - cityName      = อำเภอ/เขต (district)
 *   - districtName  = ตำบล/แขวง (sub-district)
 *   - postalCode    = รหัสไปรษณีย์
 *   - detailAddress = ที่อยู่ (full address line)
 */
export function formatAddressForFlashExpress(address: ThaiAddress): {
    name: string
    phone: string
    provinceName: string
    cityName: string
    districtName: string
    postalCode: string
    detailAddress: string
} {
    return {
        name: address.recipient_name,
        phone: address.phone_number,
        provinceName: address.province,
        cityName: address.district,
        districtName: address.sub_district || address.district,
        postalCode: address.postal_code,
        detailAddress: address.address_line2
            ? `${address.address_line1}, ${address.address_line2}`
            : address.address_line1,
    }
}
