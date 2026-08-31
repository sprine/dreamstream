import threading
from StreamDeck.DeviceManager import DeviceManager
from StreamDeck.ImageHelpers import PILHelper
from PIL import Image

# 1. Define the callback for button presses
def on_key_change(deck, key, state):
    # 'state' is True when pressed, False when released
    action = "pressed" if state else "released"
    print(f"Button {key} was {action}!")

# 2. Helper to generate and set an image on a button
def render_solid_color(deck, key, color):
    # Ask the hardware what image dimensions it expects (e.g., 72x72)
    size = deck.key_image_format()['size']
    
    # Create a solid color PIL image 
    image = Image.new("RGB", size, color)
    
    # Convert the PIL image into the raw byte format the deck requires
    native_image = PILHelper.to_native_format(deck, image)
    
    # Push the byte array to the physical button
    deck.set_key_image(key, native_image)

def main():
    # 3. Find connected Stream Decks
    decks = DeviceManager().enumerate()
    
    if len(decks) == 0:
        print("No Stream Deck found.")
        return
    
    # 4. Connect to the first found deck
    deck = decks[0]
    deck.open()
    deck.reset() # Clears all 15 screens to black
    
    # Set global brightness (0 to 100)
    deck.set_brightness(50)
    print(f"Connected to {deck.deck_type()} with {deck.key_count()} buttons.")
    
    # 5. Register the event listener
    deck.set_key_callback(on_key_change)
    
    # 6. Apply a red image to the middle button (index 7)
    # The 15 buttons are indexed 0-14, reading left-to-right, top-to-bottom.
    print("Setting button 7 to red...")
    render_solid_color(deck, key=7, color="red")
    
    print("Listening for key presses. Press Ctrl+C to exit.")
    
    try:
        # Keep the main thread alive so the background USB listening threads can run
        for t in threading.enumerate():
            if t is not threading.current_thread():
                t.join()
    except KeyboardInterrupt:
        print("\nExiting...")
    finally:
        # Clean up and release the hardware when closing
        deck.reset()
        deck.close()

if __name__ == "__main__":
    main()
