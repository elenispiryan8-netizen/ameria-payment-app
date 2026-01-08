const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// CONFIGURATION
const AMERIA_API_URL = "https://servicestest.ameriabank.am/VPOS/api/VPOS";
const AMERIA_PAY_PAGE = "https://servicestest.ameriabank.am/VPOS/Payments/Pay";
// Ensure this matches the version of Shopify API you are using
const SHOPIFY_STORE_URL = `https://${process.env.SHOP_DOMAIN}/admin/api/2024-01`;

// 1. WEBHOOK: LISTEN FOR NEW ORDERS
app.post('/api/order-created', async (req, res) => {
    const order = req.body;
    
    // 1. Log the incoming order
    console.log(`New Order Received: ${order.id}`);

    // 2. Gateway Filter
    // We only want to process orders that used our "Manual" method.
    // Check your Shopify Settings > Payments to ensure the name matches exactly.
    const gateway = order.payment_gateway_names ? order.payment_gateway_names[0] : "";
    
    if (gateway !== "manual" && gateway !== "Credit Card (Ameriabank)") {
        console.log(`Ignored: Gateway is '${gateway}'`);
        return res.status(200).send("Ignored");
    }

    // 3. Status Filter
    if (order.financial_status === 'paid') {
        console.log("Ignored: Order is already paid");
        return res.status(200).send("Ignored");
    }

    try {
        // 4. Prepare Data for Ameriabank
        // OrderID must be an integer. We use the Shopify ID.
        const payload = {
            "ClientID": process.env.AMERIA_CLIENT_ID,
            "Username": process.env.AMERIA_USERNAME,
            "Password": process.env.AMERIA_PASSWORD,
            "OrderID": order.id,
            "Amount": order.total_price,
            "Currency": "051", // 051 is the code for AMD
            "Description": `Order #${order.order_number}`,
            "BackURL": `${process.env.HOST_URL}/api/callback?shopify_order_id=${order.id}`,
        };

        // 5. Send Request to Ameriabank
        const ameriaRes = await axios.post(`${AMERIA_API_URL}/InitPayment`, payload);

        // 6. Handle Response
        if (ameriaRes.data.ResponseCode === 1) {
            const paymentID = ameriaRes.data.PaymentID;
            const payUrl = `${AMERIA_PAY_PAGE}?id=${paymentID}&lang=en`;

            // SUCCESS LOG: Copy this link from your logs to test!
            console.log("------------------------------------------------");
            console.log(`PAYMENT LINK GENERATED FOR ORDER ${order.order_number}`);
            console.log(payUrl);
            console.log("------------------------------------------------");

        } else {
            console.error("Ameria Init Failed:", ameriaRes.data.ResponseMessage);
        }
        
        res.status(200).send("Webhook received");

    } catch (error) {
        console.error("Error inside processing logic:", error.message);
        if(error.response) {
            console.error("Bank Response Data:", error.response.data);
        }
        res.status(500).send("Server Error");
    }
});

// 2. CALLBACK: CUSTOMER RETURNS FROM BANK
app.get('/api/callback', async (req, res) => {
    const { paymentID, shopify_order_id } = req.query;

    if(!paymentID || !shopify_order_id) {
        return res.send("Missing parameters.");
    }

    try {
        // A. Verify Payment with Ameriabank
        const verifyRes = await axios.post(`${AMERIA_API_URL}/GetPaymentDetails`, {
            "PaymentID": paymentID,
            "Username": process.env.AMERIA_USERNAME,
            "Password": process.env.AMERIA_PASSWORD
        });

        // B. Check Status: '00' is Success. '1' or '2' means money is secured.
        const status = verifyRes.data.OrderStatus;
        const responseCode = verifyRes.data.ResponseCode;

        if (responseCode === "00" && (status === "1" || status === "2")) {
            // C. Mark Shopify Order as PAID
            await markShopifyOrderPaid(shopify_order_id);
            res.send("<h1>Payment Successful! Your order has been confirmed.</h1>");
        } else {
            res.send(`<h1>Payment Failed. Bank Message: ${verifyRes.data.ResponseMessage}</h1>`);
        }
    } catch (error) {
        console.error("Callback failed:", error.message);
        res.status(500).send("Error verifying payment");
    }
});

// HELPER: Mark Order Paid in Shopify
async function markShopifyOrderPaid(orderId) {
    try {
        // Note: For production, you should verify the specific amount here.
        // We capture 100% of the authorized amount.
        const transactionPayload = {
            "transaction": {
                "kind": "capture",
                "status": "success"
            }
        };

        await axios.post(
            `${SHOPIFY_STORE_URL}/orders/${orderId}/transactions.json`,
            transactionPayload,
            { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN } }
        );
        console.log(`Shopify Order ${orderId} marked as PAID.`);
    } catch (error) {
        console.error("Failed to update Shopify status:", error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
