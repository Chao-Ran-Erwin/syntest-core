class ShoppingCart {
  items = [];
  constructor() {}

  // Add an item to the cart
  addItem(item, price, quantity = 1) {
    if (quantity <= 0) {
      console.error("Quantity should be positive.");
      return;
    }

    const existingItem = this.items.find((cartItem) => cartItem.item === item);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      this.items.push({ item, price, quantity });
    }
  }

  // Remove an item from the cart
  removeItem(item, quantity = 1) {
    const itemIndex = this.items.findIndex(
      (cartItem) => cartItem.item === item,
    );

    if (itemIndex === -1) {
      console.error("Item not found in cart.");
      return;
    }

    if (this.items[itemIndex].quantity > quantity) {
      this.items[itemIndex].quantity -= quantity;
    } else {
      this.items.splice(itemIndex, 1); // Remove item if quantity drops to 0 or below
    }
  }

  // Calculate total price of items in the cart
  calculateTotal() {
    return this.items.reduce((total, cartItem) => {
      return total + cartItem.price * cartItem.quantity;
    }, 0);
  }

  // View all items in the cart
  viewCart() {
    return this.items.map((cartItem) => {
      return {
        item: cartItem.item,
        price: cartItem.price,
        quantity: cartItem.quantity,
        total: cartItem.price * cartItem.quantity,
      };
    });
  }

  // Check if the cart is empty
  isEmpty() {
    return this.items.length === 0;
  }

  // Clear all items from the cart
  clearCart() {
    this.items = [];
  }

  get items() {
    return this.items;
  }

  set items(x) {
    this.items = x;
  }
}

module.exports = ShoppingCart;
