I want a completely unique and novel design for a web portfolio, making use of my paintings as ways to explore and find other paintings; interact with a painting to go to the next painting, which feels like it was part of the last, and so on. If this was somehow dynamically generated without sacrificing how convincing the interactions are, so that the site ALWAYS gave a new experience, I think that'd be the ultimate goal.

My paintings are created with this idea in mind: imagine you're in a dark closet and can't see anything. How little light does it take to be able to make something out? This experience should also drive this website's aesthetic. 

The idea is to have a completely new experience every time. The animation must be parallax, scrolled through. So, what we will need is a painting preparer that takes the image, separates it into shapes that follow strokes and colors and light, and has all of those prepared for when the site is compiled. And then we'll need a series of algorithms that match pieces of paintings to other paintings, and uses those similar spots as a transition fulcrum. The sort of effect you get is that, while you're looking at one image, you don't even realize that you're being set up to see the next. And the moment you DO see it has the unnerving effect of making you wonder how long that was sitting there, right in front of you, before you finally saw it sitting there right in front of you. For example, you might use unintentional pareidolia patterns in one image to display the actual face of the next image.

What we need to accomplish is a layered depth imaging generator that tears a painting apart by color and lighting differences. Those layers must be liquidy slices, sharded and then placed in the 3D scene at random z-axis values, but resized so that it looks perfectly in-place from directly in front, using forced perspective and anamorphic projection to display each painting.  

When viewed from other perspectives, that sharding could look like anything. And that's where we'll force the pareidolia feeling. Instead of seeing a face, the next painting is what we can force to emerge after zooming into and through those liquidy shards.   

The paintings should be forming from the last and from the next, into each other, not presenting an image, removing it, and then presenting another. It shouldn't even be a liquid morphing. You need to find creative ways to look for similarities between paintings. You shouldn't even know a transition is happening.

Let's mirror the shards. Currently, the image is sharded, and the shards placed at varying points along their z-axis between the camera's and the image's starting point. Let's mirror the shards in the opposite direction of the image's focal point so that the cloud is continuous from one image to the next.  Remember, the shards must be incontrovertably stationary and unchanging.  All movement and the fulcrum of the forced perspective is achieved ENTIRELY by the camera's own movement. 

I'm describing a system where the "content" and the "navigation" are the same thing, driven by a hidden algorithmic logic that exploits the way the human brain interprets patterns.
I've generated five variants of how these "transition fulcrums" and "shape-prepared" states could look during a scroll:

Pareidolia Emergence Transition: Focuses on that "unnerving" moment where abstract shadows in one painting slowly resolve into a face from the next as you scroll.

Structural Stroke Alignment: Demonstrates how individual shapes (separated by stroke and color) act as a puzzle, reconfiguring themselves into a new composition.

Subliminal Negative Space Reveal: Uses the lighting and negative space of a current work to "hide" the structure of the incoming painting.

Algorithmic Fulcrum View: A more abstract look at the mid-point of a transition where the paintings are most "liquid" and interchangeable.

Infinite Texture Continuity: A macro-focused view where the "infinite canvas" feel is maintained by matching the physical grit and texture of different paintings.

By using scrolling as the driver, the user controls the speed of the "reveal," which heightens that sense of wonder when they realize the image has changed without them noticing the exact moment it happened.

I'm guessing I'll have to create the backend before the front end can take shape. But the result should be that the "infinite canvas" takes up the entire view. As each image comes into its purest version (I don't think ANY of them should be shown as the original at any point) the name of the piece and info should fade in and out with it, overlaid somewhere along the bottom of the screen. My signature should be persistently overlaid in the top left corner. Clicking it displays a menu of contact info and links in a soft edged, translucent window in the middle of the screen, overlaying the infinite canvas. Anything local being linked to, like About, should display in a matching center window with the blurred translucent background.

the interface needs to be secondary to the psychological experience of the "infinite canvas." The UI shouldn't feel like a website, but rather like a thin, ethereal layer over a deep, shifting world of paint.

Some of my paintings are murals, taken out in the world. It'd be cool if part of what our painting processor did is create a depth map wherever it can find it, so the site wouldn't just take people through the paintings, but sometimes through the world they exist in.

---

*The above is the original creative brief and still describes the intended
experience accurately. For how it was actually built — the paper-theater
depth-band renderer, the pareidolia hinge graph, the bake pipeline, and
current CI/CD — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the
rest of [`docs/`](docs/README.md).*
