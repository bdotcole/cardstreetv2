const { CourierClient } = require("@trycourier/courier");
require("dotenv").config({ path: ".env.local" });

const courier = new CourierClient({ authorizationToken: process.env.COURIER_AUTH_TOKEN });

async function run() {
    try {
        const { requestId } = await courier.send({
            message: {
                to: {
                    email: "test@example.com"
                },
                content: {
                    title: "Test Output",
                    body: "This is a test message from CardStreet."
                },
                routing: {
                    method: "all",
                    channels: ["email"]
                }
            }
        });
        console.log("Courier Message sent. Request ID:", requestId);
    } catch (e) {
        console.error("Courier error:", e);
    }
}
run();
