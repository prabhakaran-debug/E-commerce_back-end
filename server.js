const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const stripe = require('stripe')('sk_test_51QXbiTDvPKd6H7CBDw4lLu7GtArh4twPxZMLdP5EWGZ3IDhCqwwlGd9h232QmUhHNrUQYXQUss46wGAwCewMMsmn003anr2FUM'); // Add your Stripe secret key here
const path = require("path");
const multer = require("multer");
const bodyParser = require("body-parser");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();


const app = express();
const port = 5001;

app.use(bodyParser.json());
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.json());


let products = [];
let currentId = 1;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads/");  // File gets saved in 'uploads/' folder
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);  // Unique file names
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
    const { productId, cartIds, totalprice } = req.body;

    console.log("Cart IDs:", cartIds);
    console.log("Total Price:", totalprice);

    try {
        let lineItems = [];

        if (cartIds && cartIds.length > 0) {

            const query = `
            SELECT products.id, products.name, products.price, cart.quantity
            FROM cart
            INNER JOIN products ON cart.product_id = products.id
            WHERE cart.product_id IN (?);


        `;

            db.query(query, [cartIds], async (error, results) => {
                if (error) {
                    console.error('Database error:', error);
                    return res.status(500).json({ error: error.message });
                }

                if (results.length === 0) {
                    return res.status(404).json({ message: "No products found for the given cart IDs" });
                }

                lineItems = results.map((product) => ({
                    price_data: {
                        currency: 'inr',
                        product_data: {
                            name: product.name,
                        },
                        unit_amount:product.price * 100, 
                    },
                    quantity: product.quantity || 1,
                    
                     
                }));

                // Create Stripe checkout session for cart items
                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: lineItems,
                    mode: 'payment',
                    success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${YOUR_DOMAIN}/cancel`,
                });

                res.status(200).json({ url: session.url });
            });

        } else if (productId) {
            console.log("Processing Single Product Checkout...");

            // Fetch product details for a single product
            db.query("SELECT * FROM products WHERE id=?", [productId], async (error, results) => {
                if (error) {
                    console.error('Database error:', error);
                    return res.status(500).json({ error: error.message });
                }

                if (results.length === 0) {
                    return res.status(404).json({ message: "Product not found" });
                }

                const product = results[0];

                // Create Stripe checkout session for single product
                const session = await stripe.checkout.sessions.create({
                    line_items: [
                        {
                            price_data: {
                                currency: 'inr',
                                product_data: {
                                    name: product.name,
                                },
                                unit_amount: product.price * 100, // Convert price to smallest currency unit
                            },
                            quantity: 1,
                        },
                    ],
                    mode: 'payment',
                    success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${YOUR_DOMAIN}/cancel`,
                });

                res.status(200).json({ url: session.url });
            });
        } else {
            return res.status(400).json({ error: "Missing productId or cartIds" });
        }
    } catch (err) {
        console.error('Stripe session creation error:', err.message);
        res.status(500).json({ error: err.message });
    }
});



app.post('/get-payment-intent', async (req, res) => {
    const { sessionId } = req.body;
    console.log("sesson id "+sessionId);
    
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


// api to fetch filter the price and category

app.post('/api/products/filter', (req, res) => {
    const { min, max, category } = req.body;

    if (min === undefined || max === undefined || min < 0 || max < 0) {
        return res.status(400).json({ error: "'min' and 'max' values must be greater than or equal to 0." });
    }

    let query = "SELECT * FROM products WHERE price BETWEEN ? AND ?";
    let queryParams = [min, max];

    if (category) {
        query += " AND category = ?";
        queryParams.push(category);
    }

    db.query(query, queryParams, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json(results);
    });
});

app.listen(5000, () => {
    console.log('Server is running on http://localhost:5000');
});

// api to fetch filter the category

app.post('/api/products/category', (req, res) => {
    const { category } = req.body;
    console.log(req.body)
    console.log("Category:"+ category);

    if (!category) {
        return res.status(400).json({ error: "Category is required" });
    }

    const query = "SELECT * FROM products WHERE category = ?";
    
    db.query(query, [category], (err, results) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database query failed" });
        }

        res.json(results);
    });
});



//API to create the order

app.post('/api/order/insert', (req, res) => {
    const { product_id, address_id, status, date } = req.body;

    console.log("Received:", { product_id, address_id, status, date });

    const query = `
        INSERT INTO \`order\` (product_id, status, address_id, date)
        VALUES (?, ?, ?, ?)
    `;

    db.query(query, [product_id, status, address_id, date], (err, result) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).json({ err: err.message });
        }

        res.status(201).json({
            message: 'Order created successfully',
            order_id: result.insertId, // Returns the new order's ID
        });
    });
});



//API to create the payment

app.post('/api/payment/insert', (req, res) => {
    const { order_id,  status ,payment_id } = req.body;
    console.log(order_id);
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
    const query = "INSERT INTO products (name, price, category, image) VALUES (?, ?, ?, ?)";
    
    console.log("Uploaded image:", image);  // Log the uploaded image filename
    
    db.query(query, [name, price, category, image], (err, results) => {
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
    const { name, price, category } = req.body;
    
    // Debug logging
    console.log('Request body:', req.body);
    console.log('File:', req.file);
    
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice)) {
        return res.status(400).json({ error: "Invalid price value" });
    }

    let query;
    let params;
    let image = null;

    try {
        // Handle image
        if (req.file) {
            image = req.file.filename;
            console.log('New image uploaded:', image);
        } else if (req.body.existingImage) {
            image = req.body.existingImage.toString();
            console.log('Using existing image:', image);
        }

        // Build query based on image presence
        if (image) {
            query = "UPDATE products SET name=?, price=?, category=?, image=? WHERE id=?";
            params = [name, parsedPrice, category, image, id];
        } else {
            query = "UPDATE products SET name=?, price=?, category=? WHERE id=?";
            params = [name, parsedPrice, category, id];
        }

        console.log('Query:', query);
        console.log('Parameters:', params);

        // Execute database query
        db.query(query, params, (error, result) => {
            if (error) {
                console.error('Database error:', error);
                return res.status(500).json({ 
                    error: error.message,
                    code: error.code,
                    sqlMessage: error.sqlMessage 
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: "Product not found" });
            }

            res.json({ 
                message: "Product updated successfully",
                imageProcessed: !!image
            });
        });
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ 
            error: "Error processing request",
            details: error.message 
        });
    }
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

  //api for insert username and password

  app.post('/api/user/insert', async (req, res) => {
    const { username, password } = req.body;
    console.log(req.body);
   
    const role_id = 1;
    try {
        // Hash password before storing
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Generated hash for password:', hashedPassword); 
        const query = "INSERT INTO users (username, password ,role_id ) VALUES (?, ? ,?)";
        db.query(query, [username, hashedPassword , role_id], (err, results) => {
            if (err) {
                return res.status(500).json({ err: err.message });
            }
            res.status(201).json({
                message: "User details added successfully",
                userId: results.insertId
            });
        });
    } catch (err) {
        console.error("Error hashing password:", err);
        res.status(500).json({ error: "Error hashing password" });
    }
});
  

//api for fetch the email and password


const JWT_SECRET = process.env.JWT_SECRET || "abdef";

app.post('/api/user', (req, res) => {
    const { username, password } = req.body;
    console.log("Request received:", req.body); 
    console.log(password);
     

    const query = "SELECT * FROM users WHERE username = ?";
    db.query(query, [username], (err, results) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "An error occurred while querying the database." });
        }

        if (results.length === 0) {
            console.log("User not found");
            return res.status(404).json({ error: "User not found." });
        }

        const user = results[0];

        console.log("Stored username in database:", user.username);
        console.log("Stored hash in database:", user.password);
        console.log("Stored role_id in database:", user.role_id);
        console.log(user.password);
        
        bcrypt.compare(password, user.password, (bcryptErr, isMatch) => {
            if (bcryptErr) {
                console.error("Bcrypt error:", bcryptErr);
                return res.status(500).json({ error: "An error occurred while validating the password." });
            }

            console.log("Password match result:", isMatch);

            if (!isMatch ) {
                console.log("Passwords do not match.");
                return res.status(401).json({status:401, error: "Invalid password" });
            }

            const token = jwt.sign({ username: user.username }, JWT_SECRET);

            res.status(200).json({
                status:200,
                message: "Login successful.",
                token,
                username:user.username,
                role_id:user.role_id,
            });
        });
    });
});


// api for fetch all the details in user table


app.get('/api/user/details', (req, res) => {
    const query = `
        SELECT users.id, users.username, users.role_id, users.password, role.id AS role_id, role.role_name 
        FROM users 
        INNER JOIN role ON users.role_id = role.id`; 

    db.query(query, (err, results) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results); 
    });
});


//api for update user table using user_id

app.put('/api/user/put/:id', (req, res) => {
    const { id } = req.params;
    const { username, user_role } = req.body;
    console.log(id);

    let query = "UPDATE `users` SET ";
    let params = [];

    if (username) {
        query += "username = ?, ";
        params.push(username);
    }

    if (user_role) {
        query += "role_id = ?, "; 
        params.push(user_role);   
    }

    query = query.slice(0, -2) + " WHERE id = ?";
    params.push(id);

    db.query(query, params, (error, result) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json({ message: "User updated successfully" });
    });
});




// api for fetch the role_name useing role_id

app.get('/api/role/:id', (req, res) => {
    const {id} =req.params;
db.query("SELECT role_name FROM role WHERE id = ?", [id], (error, results) => {
    if (error) {
        console.error("Database query error:", error); 
        return res.status(500).json({ error: "An internal server error occurred." });
    }

    if (results.length === 0) {
        return res.status(404).json({ message: "role not found." });
    }
    console.log(results[0])
    res.json(results[0]); 
});
});


//api for update user password


app.put('/api/user/update', (req, res) => {
    const { username, newPassword, confirmPassword } = req.body;

    console.log("Request received for updating password:", req.body);

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: "Passwords do not match." });
    }

    const query = "SELECT * FROM users WHERE username = ?";
    
    db.query(query, [username], (err, results) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ success: false, message: "An error occurred while querying the database." });
        }

        if (results.length === 0) {
            console.log("User not found");
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // Hash the new password before updating
        bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
            if (hashErr) {
                console.error("Error hashing new password:", hashErr);
                return res.status(500).json({ success: false, message: "An error occurred while hashing the password." });
            }

            const updateQuery = "UPDATE users SET password = ? WHERE username = ?";
            db.query(updateQuery, [hashedPassword, username], (updateErr, updateResults) => {
                if (updateErr) {
                    console.error("Database update error:", updateErr);
                    return res.status(500).json({ success: false, message: "An error occurred while updating the password." });
                }

                console.log("Password updated successfully.");
                res.status(200).json({ success: true, message: "Password updated successfully." });
            });
        });
    });
});






// api for insert cart 

app.post('/api/cart/insert', (req, res) => {
    const { product_id, quantity } = req.body;

    if (!product_id || !quantity) {
        return res.status(400).json({ error: "Product ID and quantity are required" });
    }

    // Check if the product already exists in the cart
    const checkQuery = "SELECT quantity FROM cart WHERE product_id = ?";

    db.query(checkQuery, [product_id], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (results.length > 0) {
            // Product exists, update the quantity
            const newQuantity = results[0].quantity + quantity;
            const updateQuery = "UPDATE cart SET quantity = ? WHERE product_id = ?";

            db.query(updateQuery, [newQuantity, product_id], (err, updateResults) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                return res.status(200).json({ message: "Cart updated successfully" });
            });

        } else {
            // Product does not exist, insert new row
            const insertQuery = "INSERT INTO cart (product_id, quantity) VALUES (?, ?)";

            db.query(insertQuery, [product_id, quantity], (err, insertResults) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                return res.status(201).json({ message: "Cart added successfully" });
            });
        }
    });
});



app.get('/api/cartpage', (req, res) => {
    console.log('cartpage');
    db.query(`SELECT products.*, cart.quantity 
              FROM products 
              JOIN cart ON products.id = cart.product_id;`, (error, results) => {
        if (error) {
            console.error("Database query error:", error);
            res.status(500).json({ error: error.message });
        } else {
            console.log("Results from query:", results);  
            if (results.length === 0) {
                res.status(404).json({ message: "No products found in the cart" });
            } else {
                res.json(results);  
            }
        }
    });
});


//update quantity 

app.put('/api/cartpage/update/:product_id', (req, res) => {
    const { product_id } = req.params; 
    const { quantity } = req.body;  
    console.log(product_id);
    console.log(quantity);
     

    if (quantity === undefined) {
        return res.status(400).json({ message: "Quantity is required" });
    }

    const query = "UPDATE cart SET quantity=? WHERE product_id=?";
    db.query(query, [quantity, product_id], (error, results) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: "Product not found" });
        }

        res.json({ message: "Product updated successfully" });
    });
});


// API endpoint to delete a cart product by ID

app.delete('/api/cartpage/delete/:product_id', (req, res) => {
    const { product_id } = req.params; 
    
    db.query("DELETE FROM cart WHERE product_id=?", [product_id], (error, results) => {
        if (error) {
            console.error("Database Error:", error); 
            return res.status(500).json({ error: error.message });
        }

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: "Product not found in cart" }); // Handle case where no rows are affected
        }

        res.json({ message: "Cart product deleted successfully" }); // Success response
    });
});

//api to fetch order table

app.post('/api/order-products', async (req, res) => {
    const { orderIds, status, date } = req.body;

    console.log("Received order IDs:", orderIds);
    console.log("Received order status:", status);
    console.log("Received order date:", date);

    try {
        const promises = orderIds.map(async (id, index) => {
            const currentStatus = status[index];
            const currentDate = date[index];

            console.log(id, currentStatus);

            const [orderResults] = await db.promise().query(
                'SELECT product_id, address_id FROM `order` WHERE id = ?', [id]
            );

            if (!orderResults.length) {
                throw new Error(`Order ID ${id} not found`);
            }

            const productIds = orderResults.map(row => row.product_id);
            const addressIds = orderResults.map(row => row.address_id);
            console.log('order details',productIds,addressIds)

            if (productIds.length === 0) {
                throw new Error(`No products found for Order ID ${id}`);
            }

            const [productResults] = await db.promise().query(
                `SELECT * FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
                productIds
            );

            const [addressResults] = await db.promise().query(
                `SELECT * FROM address WHERE id IN (${addressIds.map(() => '?').join(',')})`,
                addressIds
            );

            console.log("addressresults",addressResults);
            

            return {
                address: addressResults,
                orderId: id,
                status: currentStatus,
                date: currentDate,
                products: productResults
            };
        });

        const allProductResults = await Promise.all(promises);

        console.log('--------------');
        console.log(allProductResults);
        console.log('--------------');

        res.json(allProductResults);
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});


  
  



//api to fetch the order

app.get('/api/order', (req, res) => {
    
    db.query("SELECT * FROM `order`", (err, results) => {
        if (err) {
            res.status(500).json({ err: err.message });
        } else {
            res.json(results);
        }
    });
});




//find product_id using order_id
app.delete('/api/order/:id', (req, res) => {
    const { id } = req.params;
    console.log("Deleting products from cart for order_id:", id);
  
    // Query to get the product_ids for the given order_id
    db.query("SELECT product_id FROM ecommerence.order WHERE id = ?", [id], (error, results) => {
      if (error) {
        console.error("Error fetching product_ids:", error);
        return res.status(500).json({ error: error.message });
      }
  
      if (results.length === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
  
      const productIds = results[0].product_id;
      console.log('Fetched product_id:', productIds);
  
      try {
        // Assuming product_id is already an array
        let productIdArray;
        
        // If it's an array already (which it seems to be), use it directly
        if (Array.isArray(productIds)) {
          productIdArray = productIds;
        } else {
          // Otherwise, handle the case where it might still be a string that needs to be split
          productIdArray = productIds.split(',').map(id => parseInt(id.trim()));
        }
  
        console.log('Parsed product_ids:', productIdArray);
  
        // Create placeholders for query
        const placeholders = productIdArray.map(() => '?').join(',');
        const deleteQuery = `DELETE FROM ecommerence.cart WHERE product_id IN (${placeholders})`;
  
        // Run the delete query
        db.query(deleteQuery, productIdArray, (deleteError, deleteResults) => {
          if (deleteError) {
            console.error("Error deleting from cart:", deleteError);
            return res.status(500).json({ error: deleteError.message });
          } else {
            return res.json({ message: "Products deleted successfully" });
          }
        });
  
      } catch (parseError) {
        console.error('Error parsing product_id:', parseError);
        return res.status(400).json({ error: 'Invalid product_id format' });
      }
    });
  });
  
  
  
  
 


  
  
  
  

  


// Start the server only once
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});