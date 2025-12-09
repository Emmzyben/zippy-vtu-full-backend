const fetch = require("node-fetch");

async function testEmail() {
    try {
        console.log("Testing email sending with GET...");

        const params = new URLSearchParams();
        params.append('email', 'test@example.com');
        params.append('subject', 'Test from Debugger');
        params.append('message', 'This is a test message.');

        const url = "https://connecta.uk/send_email.php" + params.toString();
        console.log("URL:", url);

        const response = await fetch(url, {
            method: "GET"
        });

        console.log("Status Code:", response.status);
        const text = await response.text();
        console.log("Raw response:", text);

    } catch (error) {
        console.error("Error:", error);
    }
}

testEmail();
