const API_URL = process.env.SHIPPOP_API_URL || 'https://mkpservice.shippop.dev';
const API_KEY = process.env.SHIPPOP_API_KEY || 'dv4ae98045681b56d035a33e443ac91312f2bf2fa7f87191eb0ca0f38a4a7b5696fab13c28fb2fdec01771411081';
const EMAIL = process.env.SHIPPOP_EMAIL || 'brandonlcole35@gmail.com';

export interface Address {
    name: string;
    address: string;
    district: string;
    state: string;
    province: string;
    postcode: string;
    tel: string;
}

export interface Parcel {
    name: string;
    weight: number;
    width: number;
    length: number;
    height: number;
}

export interface Product {
    product_code: string;
    name: string;
    price: number;
    amount: number;
    weight: number;
    category?: string;
}

export interface BookingData {
    from: Address;
    to: Address;
    parcel: Parcel;
    courier_code: string;
    product?: Record<string, Product>;
    cod_amount?: number;
}

export async function createBooking(data: BookingData[]) {
    const payload = {
        api_key: API_KEY,
        email: EMAIL,
        data
    };

    const response = await fetch(`${API_URL}/booking/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`SHIPPOP Booking failed: ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.status) {
        throw new Error(`SHIPPOP Error: ${JSON.stringify(result)}`);
    }

    return result;
}

export async function confirmOrder(purchase_id: number) {
    const payload = {
        api_key: API_KEY,
        purchase_id
    };

    const response = await fetch(`${API_URL}/confirm/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`SHIPPOP Confirm failed: ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.status) {
        throw new Error(`SHIPPOP Error: ${JSON.stringify(result)}`);
    }

    return result;
}

export async function getLabelUrl(purchase_id: number, size: string = 'sticker4x6') {
    const payload = {
        api_key: API_KEY,
        purchase_id,
        size
    };

    const response = await fetch(`${API_URL}/v2/label/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`SHIPPOP Label failed: ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.status) {
        throw new Error(`SHIPPOP Error: ${JSON.stringify(result)}`);
    }

    // usually `result.data` or `result.url` might contain the link, but wait...
    // The Postman docs usually return `url` directly or a structure. I'll just return the full result.
    return result;
}
