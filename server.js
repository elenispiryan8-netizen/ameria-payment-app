const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// CONFIG
const AMERIA_API_URL = "https://servicestest.ameriabank.am/VPOS/api/VPOS";
const AMERIA_PAY_PAGE = "https://servicestest.ameriabank.am/VPOS/Payments/Pay";
// Note: We use the API version 2024-01 for stability
const SHOPIFY_STORE_URL = `https://${process.env.SHOP_DOMAIN}/admin/api/2024-01`;

// 1. WEBHOOK: LISTEN FOR NEW ORDERS
app.post('/api/order-created', async (req, res) => {
    const order = req.body;
    console.log(`New Order Received: ${order.id}`);

    // Filter: Only process if the user selected "Credit Card (Ameriabank)"
    const gateway = order.payment_gateway_names ? order.payment_gateway_names[0] : "";
    
    // Check if it's our manual payment method
    if (gateway !== "manual" && gateway !== "Credit Card (Ameriabank)") {
        return res.status(200).send("Ignored: Not an Ameria order");
    }

    if (order.financial_status === 'paid') {
        return res.status(200).send("Ignored: Already paid");
    }

    try {
        // A. Initialize Payment with Ameria
        // Ameria requires a unique numeric OrderID. We use the Shopify Order ID.
        const payload = {
            "ClientID": process.env.AMERIA_CLIENT_ID,
            "Username": process.env.AMERIA_USERNAME,
            "Password": process.env.AMERIA_PASSWORD,
            "OrderID": order.id,                      
            "Amount": order.total_price,              
            "Currency": "051",                        // 051 = AMD (Armenian Dram)
            "Description": `Order #${order.order_number}`,
            "BackURL": `${process.env.HOST_URL}/api/callback?shopify_order_id=${order.id}`, 
        };

        const ameriaRes = await axios.post(`${AMERIA_API_URL}/InitPayment`, payload);

        [cite_start]// Check response code [cite: 66, 75]
        if (ameriaRes.data.ResponseCode === 1) {
            const paymentID = ameriaRes.data.PaymentID;
            const payUrl = `${AMERIA_PAY_PAGE}?id=${paymentID}&lang=en`;

            // B. Log the Payment Link (This is what you send to the customer)
            console.log("========================================");
            console.log(`PAYMENT LINK FOR ORDER ${order.order_number}:`);
            console.log(payUrl);
            console.log("========================================");
            
            // In a real production app, you would email this link here using 'nodemailer'
        } else {
            console.error("Ameria Init Failed:", ameriaRes.data.ResponseMessage);
        }
        
        res.status(200).send("Webhook received");
    } catch (error) {
        console.error("Error processing order:", error.message);
        res.status(500).send("Error");
    }
});

// 2. CALLBACK: CUSTOMER RETURNS FROM BANK
app.get('/api/callback', async (req, res) => {
    const { paymentID, shopify_order_id } = req.query;

    try {
        [cite_start]// A. Verify Payment with Ameria [cite: 90]
        const verifyRes = await axios.post(`${AMERIA_API_URL}/GetPaymentDetails`, {
            "PaymentID": paymentID,
            "Username": process.env.AMERIA_USERNAME,
            "Password": process.env.AMERIA_PASSWORD
        });

        [cite_start]// Check if Approved (1) or Deposited (2) [cite: 654]
        [cite_start]// And ResponseCode "00" [cite: 649]
        const status = verifyRes.data.OrderStatus;
        if (verifyRes.data.ResponseCode === "00" && (status === "1" || status === "2")) {

            // B. Mark Shopify Order as PAID
            await markShopifyOrderPaid(shopify_order_id);
            
            res.send("<h1>Payment Successful! Your order is confirmed.</h1>");
        } else {
            res.send(`<h1>Payment Failed or Pending. Message: ${verifyRes.data.ResponseMessage}</h1>`);
        }
    } catch (error) {
        console.error("Callback failed:", error.message);
        res.status(500).send("Error verifying payment");
    }
});

// HELPER: Mark Order Paid in Shopify
async function markShopifyOrderPaid(orderId) {
    const transactionPayload = {
        "transaction": {
            "kind": "capture",
            "status": "success",
            "amount": "100.00" // Note: In production, fetch the actual order amount
        }
    };

    await axios.post(
        `${SHOPIFY_STORE_URL}/orders/${orderId}/transactions.json`,
        transactionPayload,
        { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN } }
    );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
