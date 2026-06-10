const Courier = require("@trycourier/courier");
const CourierClient = Courier.CourierClient || Courier.default || Courier;
require('dotenv').config({ path: '.env.local' });

const courier = new CourierClient({
    apiKey: (process.env.COURIER_AUTH_TOKEN || "mock_token").trim()
});

async function testConnection() {
    console.log("Token:", process.env.COURIER_AUTH_TOKEN ? "Exists" : "MISSING");
    try {
        const { brands } = await courier.brands.list();
        console.log("Connection successful! Found brands:", brands.length);
    } catch (error) {
        console.error("Connection failed:", error.message);
        if (error.response) {
            console.error("Response:", JSON.stringify(error.response.data, null, 2));
        }
    }
}

testConnection();
