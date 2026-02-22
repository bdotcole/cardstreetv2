import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from '@/screens/HomeScreen';
import ExploreScreen from '@/screens/ExploreScreen';
import ScannerScreen from '@/screens/ScannerScreen';
import MarketplaceScreen from '@/screens/MarketplaceScreen';
import VaultScreen from '@/screens/VaultScreen';
import ProfileScreen from '@/screens/ProfileScreen';
import CardDetailsScreen from '@/screens/CardDetailsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabNavigator() {
    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: '#0f172a', // brand-darker
                    borderTopWidth: 1,
                    borderTopColor: 'rgba(255,255,255,0.05)',
                    height: 70, // Taller, modern bottom bar,
                    paddingBottom: 10,
                    paddingTop: 10,
                },
                tabBarActiveTintColor: '#06b6d4', // brand-cyan
                tabBarInactiveTintColor: '#64748b', // slate-500
                tabBarShowLabel: true,
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontWeight: '700',
                    marginTop: 0,
                },
            }}
        >
            <Tab.Screen
                name="Home"
                component={HomeScreen}
                options={{
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? "home" : "home-outline"} size={24} color={color} />
                    ),
                }}
            />
            <Tab.Screen
                name="Shop"
                component={MarketplaceScreen}
                options={{
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? "cart" : "cart-outline"} size={24} color={color} />
                    ),
                }}
            />
            <Tab.Screen
                name="Explore"
                component={ExploreScreen}
                options={{
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? "search" : "search-outline"} size={24} color={color} />
                    ),
                }}
            />
            <Tab.Screen
                name="Scan"
                component={ScannerScreen}
                options={{
                    tabBarLabel: () => null, // Hide label for center button
                    tabBarIcon: ({ focused }) => (
                        <View className="mb-6 w-14 h-14 bg-brand-cyan rounded-full items-center justify-center shadow-lg shadow-brand-cyan/50 border-4 border-brand-darker">
                            <Ionicons name="scan" size={28} color="#0f172a" />
                        </View>
                    ),
                }}
            />

            <Tab.Screen
                name="Vault"
                component={VaultScreen}
                options={{
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? "albums" : "albums-outline"} size={24} color={color} />
                    ),
                }}
            />
            <Tab.Screen
                name="Profile"
                component={ProfileScreen}
                options={{
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? "person" : "person-outline"} size={24} color={color} />
                    ),
                }}
            />
        </Tab.Navigator>
    );
}

export default function Navigation() {
    return (
        <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Tabs" component={TabNavigator} />
                <Stack.Screen name="CardDetails" component={CardDetailsScreen} options={{ presentation: 'modal' }} />
            </Stack.Navigator>
            <StatusBar style="light" />
        </NavigationContainer>
    );
}
