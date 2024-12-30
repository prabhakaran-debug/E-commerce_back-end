const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const stripe = require('stripe')('sk_test_51QXbiTDvPKd6H7CBDw4lLu7GtArh4twPxZMLdP5EWGZ3IDhCqwwlGd9h232QmUhHNrUQYXQUss46wGAwCewMMsmn003anr2FUM'); // Add your Stripe secret key here
const path = require("path");
const multer = require("multer");
const bodyParser = require("body-parser");


const app = express();
const port = 5000;

app.use(bodyParser.json());
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.json());

let products = [];
let currentId = 1;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });
  
  const upload = multer({ storage });

// MySQL connection setup
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'ecommerence',
    port: 3306
});

// Connect to MySQL
db.connect(err => {
    if (err) {
        console.error("Error connecting to MySQL:", err.message);
    } else {
        console.log("Connected to MySQL database.");
    }
});

// Payment Stripe setup
const YOUR_DOMAIN = 'http://localhost:3000';  

app.post('/create-checkout-session', async (req, res) => {
    const { productId } = req.body; 

   
    if (!productId) {
        return res.status(400).json({ error: "Missing productId" });
    }

    // Fetch product details from MySQL
    db.query("SELECT * FROM products WHERE id=?", [productId], async (error, results) => {
        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({ error: error.message });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: "Product not found" });
        }

        const product = results[0];

        try {
            // Create a Stripe checkout session
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'inr',
                            product_data: {
                                name: product.name,
                            },
                            unit_amount: product.price * 100, 
                        },
                        quantity: 1,  
                    },
                ],
                mode: 'payment',
                success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${YOUR_DOMAIN}/cancel`,
            });

            // Send the session URL back to the frontend
            res.json({ url: session.url });
        } catch (err) {
            console.error('Stripe session creation error:', err);
            res.status(500).json({ err: err.message });
        }
    });
});


app.post('/get-payment-intent', async (req, res) => {
    const { sessionId } = req.body;

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        res.json({ session });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to fetch products
app.get('/api/products', (req, res) => {
    db.query("SELECT * FROM products", (err, results) => {
        if (err) {
            res.status(500).json({ err: err.message });
        } else {
            res.json(results);
        }
    });
});


//API to create the order

app.post('/api/order/insert', (req, res) => {
    const { product_id, address_id, status } = req.body;

    const query = `INSERT INTO \`order\` (product_id, status, address_id) VALUES (?, ?, ?)`;
    console.log(product_id, status, address_id);
    db.query(query, [product_id, status, address_id], (err, result) => {
        
        if (err) {
            return res.status(500).json({ err: err.message });
        }

        res.status(201).json({
            message: 'Order created successfully',
            order_id: result.insertId, 
        });
    });
});


//API to create the payment

app.post('/api/payment/insert', (req, res) => {
    const { order_id,  status ,payment_id } = req.body;

    const query = `INSERT INTO payment ( order_id,  status ,payment_id ) VALUES (?, ?, ?)`;
    // console.log(product_id, status, address_id);
    db.query(query, [ order_id,  status ,payment_id ], (err, result) => {
        
        if (err) {
            return res.status(500).json({ err: err.message });
        }

        res.status(201).json({
            message: 'payment created successfully',
            order_id: result.insertId, 
        });
    });
});




// API endpoint to insert a product
app.post('/api/product/insert', upload.single("image"), (req, res) => {
    const { name, price, category } = req.body;
    
    
    const image = req.file ? req.file.filename : null;
    const query = "INSERT INTO products (name, price, category,image) VALUES (?, ?, ?,?)";
    console.log(image)
    db.query(query, [name, price, category,image], (err, results) => {
        if (err) {
            res.status(500).json({ err: err.message });
        } else {
            res.status(201).json({ 
                message: "Product added successfully",
                productId: results.insertId 
            });
        }
    });
});

// API endpoint to get a product by ID
app.get('/api/product/:id', (req, res) => {
    const { id } = req.params;
    db.query("SELECT * FROM products WHERE id=?", [id], (error, results) => {
        if (error) {
            res.status(500).json({ error: error.message });
        } else if (results.length === 0) {
            res.status(404).json({ message: "Product not found" });
        } else {
            res.json(results[0]);
        }
    });
});

// API endpoint to update a product by ID
app.put('/api/product/put/:id', upload.single('image'), (req, res) => {
    const { id } = req.params;
    const { name, price, category  } = req.body;

    let image = req.file ? req.file.filename : null;
    if (!image && req.body.existingImage) {
      image = req.body.existingImage;
    }
    console.log(req.body);
    
    console.log("image :"+image);
    db.query("UPDATE `products` SET name=?, price=?, category=?, image=?  WHERE id=? ", [name, price, category,image,id], (error, result) => {
        if (error) {
            res.status(500).json({ error: error.message });
        } else if (result.affectedRows === 0) {
            res.status(404).json({ message: "Product not found" });
        } else {
            res.json({ message: "Product updated successfully" });
        }
    });
});

// API endpoint to delete a product by ID
app.delete('/api/product/delete/:id', (req, res) => {
    const { id } = req.params;
    db.query("DELETE FROM products WHERE id=?", [id], (error, results) => {
        if (error) {
            res.status(500).json({ error: error.message });
        } else if (results.affectedRows === 0) {
            res.status(404).json({ message: "Product not found" });
        } else {
            res.json({ message: "Product deleted successfully" });
        }
    });
});


// api for fetch address

app.get('/api/address', (req, res) => {
    db.query("SELECT * FROM address", (err, results) => {
        if (err) {
            res.status(500).json({ err: err.message });
        } else {
            res.json(results);
        }
    });
});


     
    //delete the address by id


    app.delete('/api/address/delete/:id', (req, res) => {
        const { id } = req.params;
        db.query("DELETE FROM address WHERE id=?", [id], (error, results) => {
            if (error) {
                res.status(500).json({ error: error.message });
            } else if (results.affectedRows === 0) {
                res.status(404).json({ message: "address not found" });
            } else {
                res.json({ message: "address deleted successfully" });
            }
        });
    });


    // Query the database for the address with the given ID
    app.get('/api/address/:id', (req, res) => {
        const {id} =req.params;
    db.query("SELECT * FROM address WHERE id = ?", [id], (error, results) => {
        if (error) {
            console.error("Database query error:", error); // Log error for debugging
            return res.status(500).json({ error: "An internal server error occurred." });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: "Address not found." });
        }
        console.log(results[0])
        res.json(results[0]); // Send the first result as a response
    });
});







//api for insert values


app.post('/api/address/insert', (req, res) => {
    const {houseNo, street, city, state, country} = req.body;

    const query = "INSERT INTO address (houseNo, street, city, state, country) VALUES (?, ?, ?,? ,?)";

    db.query(query, [houseNo, street,city, state, country], (err, results) => {
        if (err) {
            res.status(500).json({ err: err.message });
        } else {
            res.status(201).json({ 
                message: "address added successfully",
                productId: results.insertId 
            });
        }
    });
});


//api for update address



app.put('/api/address/put/:id', (req, res) => {
    const { id } = req.params;
    const { houseNo, street, city, state, country } = req.body;
    console.log(req.body);
    
   
    db.query(
        "UPDATE address SET houseNo=?, street=?, city=?, state=?, country=? WHERE id=?",
        [houseNo, street, city, state, country, id],
        (error, result) => {
            if (error) {
                res.status(500).json({ error: error.message });
            } else if (result.affectedRows === 0) {
                res.status(404).json({ message: "Product not found" });
            } else {
                res.json({ message: "Product updated successfully" });
            }
        }
    );
});





//api for delete address

app.delete('/api/address/delete/:id', (req, res) => {
    const { id } = req.params;
    db.query("DELETE FROM address WHERE id=?", [id], (error, results) => {
        if (error) {
            res.status(500).json({ error: error.message });
        } else if (results.affectedRows === 0) {
            res.status(404).json({ message: "Product not found" });
        } else {
            res.json({ message: "Product deleted successfully" });
        }
    });
});


// api for insert order 

app.post('/api/order/insert', (req, res) => {
    const {houseNo, street, city, state, country} = req.body;

    const query = "INSERT INTO order (houseNo, street, city, state, country) VALUES (?, ?, ?,? ,?)";

    db.query(query, [houseNo, street,city, state, country], (err, results) => {
        if (err) {
            res.status(500).json({ err: err.message });
        } else {
            res.status(201).json({ 
                message: "order added successfully",
                productId: results.insertId 
            });
        }
    });
});


// api for update order



app.put('/api/order/put/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    console.log(id,status)
    db.query("UPDATE `order` SET status=? WHERE id=?", [status, id], (error, result) => {
        if (error) {
            res.status(500).json({ error: error.message });
        } else if (result.affectedRows === 0) {
            res.status(404).json({ message: "Order not found" });
        } else {
            res.json({ message: "Order updated successfully" });
        }
    });
});


// Start the server only once
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
