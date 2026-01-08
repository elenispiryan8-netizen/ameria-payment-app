const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- CONFIGURATION ---
const AMERIA_API_URL = process.env.AMERIA_API_URL || "https://servicestest.ameriabank.am/VPOS/api/VPOS";
const PAY_PAGE_URL = "https://servicestest.ameriabank.am/VPOS/Payments/Pay";

// 1. INITIALIZE PAYMENT
// Shopify calls this endpoint when the user clicks "Pay"
app.post('/api/pay', async (req, res) => {
    const { orderId, amount, currency } = req.body;

    // "BackURL" is where Ameria redirects the user after payment 
    // This must match your Render URL once deployed
    const backUrl = `${process.env.HOST_URL}/api/callback`;

    const payload = {
        "ClientID": process.env.AMERIA_CLIENT_ID,     // 
        "Username": process.env.AMERIA_USERNAME,      // 
        "Password": process.env.AMERIA_PASSWORD,      // 
        "OrderID": orderId,                           // 
        "Amount": amount,                             // 
        "Description": `Order #${orderId}`,           // 
        "BackURL": backUrl,                           // 
        "Currency": currency || "051" // Default AMD  // 
    };

    try {
        //  Call InitPayment
        const response = await axios.post(`${AMERIA_API_URL}/InitPayment`, payload);
        
        // [cite: 66] ResponseCode 1 means successful initialization
        if (response.data.ResponseCode === 1) {
            const paymentID = response.data.PaymentID;
            
            // Return the redirect URL to the frontend
            // [cite: 84] Construct the redirect URL
            return res.json({ 
                redirectUrl: `${PAY_PAGE_URL}?id=${paymentID}&lang=en` 
            });
        } else {
            console.error("Ameria Init Error:", response.data.ResponseMessage);
            return res.status(400).json({ error: response.data.ResponseMessage });
        }
    } catch (error) {
        console.error("Server Error:", error.message);
        return res.status(500).json({ error: "Payment Initialization Failed" });
    }
});

// 2. CALLBACK HANDLER
// Ameriabank redirects user here after payment [cite: 87]
app.get('/api/callback', async (req, res) => {
    const { paymentID, responseCode, orderID } = req.query; // [cite: 88]

    // Note: Never trust 'responseCode' from URL blindly. Verify it server-side. [cite: 89]
    try {
        const verifyPayload = {
            "PaymentID": paymentID,              // [cite: 92]
            "Username": process.env.AMERIA_USERNAME, 
            "Password": process.env.AMERIA_PASSWORD
        };

        //  GetPaymentDetails
        const response = await axios.post(`${AMERIA_API_URL}/GetPaymentDetails`, verifyPayload);
        const details = response.data;

        // [cite: 653] Check if OrderStatus is "2" (Deposited) or "1" (Approved)
        // [cite: 649] ResponseCode "00" is success
        if (details.ResponseCode === "00" && (details.OrderStatus === "2" || details.OrderStatus === "1")) {
            // SUCCESS: Redirect user to Shopify "Thank You" page
            // You should also update Shopify order status via API here
            res.send(`<h1>Payment Successful!</h1><p>Order ${orderID} is confirmed.</p>`);
        } else {
            // FAILURE
            res.send(`<h1>Payment Failed</h1><p>Reason: ${details.ResponseMessage}</p>`);
        }

    } catch (error) {
        res.status(500).send("Error verifying payment");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
