![fogland](https://files.catbox.moe/fl3252.png)
# What's this?

I saw an ad for Fog of World on twitter and thought it was cool. Then I saw it was $30

Here is a free version (special thanks to my university for letting me use gemini pro even after graduation)

# How to build

```
npm install
npm run build
npx cap sync android
```

Go to android studio and do what needs to be done.

Also works on browser so itoddlers can use it. You just need to host it on your server (or a virtual machine i guess)
Then just connect to it via browser. (make sure you do https or else phones throw a hissy-fit about permissions)


# How to use

Fogland let's you explore your neighborhood using OSM tags. Then, from these tags, stars will be placed around your map. Each star is a collectable landmark. If you open the settings, you can see what tags are being used by default. It's fully customizable so feel free to add your own or deselect tags you aren't interested in. Please keep in mind that if you add too many tags you will get ratelimited by openstreetmap so please try to limit the number of tags.

https://wiki.openstreetmap.org/wiki/Map_features

You can click the search button to do a fresh search for new landmarks. Each landmark you collect will get added to your bag. If a landmark has a wikipedia page, that will be linked in the bag too! You can filter the tags by only having ones with wikipedia pages show up in your map. This might be useful for super touristy places where the number of landmarks is overwhelming and you want to just go to the most famous places.

Stars with a little tree are places that have a boundary (like parks for example). To collect those landmarks, you need to explore a certain percentage of the boundary. For parks this is trivial but bigger areas like national parks can require a lot more exploring.

On android, you can enable background location tracking. It can drain your battery though so be careful.

The app also allows for exporting and importing your config. It will let you store and restore your travel history and your landmarks. It's broken on the native version right now but I'll fix it soon.

# Try it out
Here is my vercel version. It's all local so your information is safe don't worry. The web version doesn't allow for background location tracking but the native app does (on android).

Make sure you allow location and sensors for the website in your browser.

https://fogland.vercel.app/
