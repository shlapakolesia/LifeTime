import { appConfig } from "../config";
import { createCognitoClient } from "./cognitoClient";

export const cognito = createCognitoClient(appConfig.cognito);
