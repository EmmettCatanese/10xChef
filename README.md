# 10xChef
All in one app to manage, plan, and shop for recipes

## Why?

A lot of weeknights my family doesn't know what to make for dinner. We strive to be organized people but its hard to figure out what you're making each night, then plan and shop for those groceries. Although it would seem easy, it can be quite the headache. I made this app to help you become a much more organized and effective home cook. 

## A little on how the backend works

The primary functionality of the app is the frontend and how it enterprets recipes, but the core functionality relies on being able to extract recipes. The way I decided to build this was with a FastAPI. If you've ever googled looking for a recipe before, you'll have noticed that google is able to extract recipe data like rating, number of ingredients, and cook time. That isn't from some sort of ML model. That's because most recipes on the internet follow the JSON-LD recipe format. This is structured data under the hood of most recipes ripe for the taking. My first POC hit the websites directly and scraped the JSON-LD but I wouldn't want to get blocked by any websites. Instead, I opted to first attempt to find an archive of the website on internet archive using CDX. It will search for the most recent archive of the page and request the LD version which is the raw originally recorded version of the website that was archived, not the modified version that you are typically presented with the wayback machine. All recipes are also cached in a SQLite database so a website is only retrieved once. 

Downsides to this approach include that the internet archive is much slower than requesting the website directly but it pays in the long run when my server doesn't get blocked from them! Additionally, both the cache and internet archive wont have the most up to date version of the website / recipe if it has been changed. That being said, it should be pretty darn close and this is an edge case.

## Features

There are a multitude of features but I want to highlight the main features that will help with your workflow.

### Adding recipes to your recipes

To add a recipe to your recipes, all you need to do is paste in the link. It will then be added as a chip in your recipes. You can see the instructions, ingredients, as well as the orginal servings. You can scale the recipe up or down. It should be noted, it only scales the measurements in the ingredients section. If a recipe calls for a certain measurement in the recipe itself, it wont be adjusted. 

### Adding recipes to your week plan

Once you have some recipes you want, you can add them to your week. All you need to do is drag a tile to the day that you want to schedule and it is planned. This allows you to visualize your weekly plan and see that you are prepared. This helps me feel not as anxious about not being prepared for dinner every day of the week. If you scale a recipe in the your recipes section and then drag it in to the week, it will save that ingredient volume.

### Viewing your shopping list

Once you have scheduled your week, you can shop for your groceries. I developed a very basic algorithm to help sort out your groceries in to different departments. You can change the order based on how your grocery store might flow. Originally I wanted to make a "Google Maps" for grocery stores type app that calculates your optimal route but it just wasn't feasable. This helps you still stay efficient in grocery shopping. Conversely, if you used the NYT Cooking grocery list feature for example, the grocery list is sorted by recipe, not department. My app will also do its best to consolidate ingredients so that if two recipes call for the same ingredient, it will add them up.

### Cooking

Once it's time to cook, you can click on the recipe in your calendar and it will take you to the cooking mode. This shows your ingrdients as well as instructions. You can also scale recipes in this area. You can check off ingredients and instructions as you do them if you would like. You can also show two recipes side by side if you click in the top right for "cook alongside".

## Improvements

This app definitely isn't perfect. One thing I want to add is a backend user data storage. Right now all of your recipes and groceries are stored on your device and stay on your device. It would be nice to have an account system so that way you can go between say your computer and your phone. If there's enough interest I would definitely implement it using Firebase. Another improvement is the Natural Language Processing. Because of the nature of human writing, the ingredient lists are all very different and random and in their own styles. Ideally good NLP would help standardize the format of the ingredients but I am just not there yet. 
